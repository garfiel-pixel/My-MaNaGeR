/* ============================================================
   My MaNaGeR , Application Controller Module
   Initialization, event handlers, drawer, modals, toast,
   keyboard shortcuts, theme, crosshair, methodology learning card.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const S = () => ns.State.getState();
  const U = ns.Utils;
  const R = ns.Render;

  // ---- Project ID ----
  const urlParams = new URLSearchParams(window.location.search);
  ns.projectId = urlParams.get('id') || localStorage.getItem('mmgr_current_project') || 'default';

  // OWNER 2026-09-17 (id-mismatch fix, boot migration): before the old
  // import fix, ids with spaces could enter the admin list and every
  // id-scoped key (mmgr_state_<id>, mmgr_unlocked_<id>, cloud routes) was
  // then namespaced under the spaced id, while the cloud twin lived under
  // the slug. On boot, rename any such id once, atomically, everywhere it
  // lives. URL-facing ids can't be migrated here (the address bar names
  // them), so those keep their spaced id - they still sync through the
  // mmgr_cloud_id override below.
  (function migrateSpacedProjectIds() {
    try {
      const id = ns.projectId;
      if (!id || !/\s/.test(id)) {
        return;
      } // nothing to fix
      const slug =
        id
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '') || 'project';
      if (localStorage.getItem('mmgr_state_' + slug)) {
        return;
      } // target exists: never clobber
      ['mmgr_state_', 'mmgr_unlocked_', 'mmgr_scope_'].forEach(function (prefix) {
        const v = localStorage.getItem(prefix + id);
        if (v !== null) {
          localStorage.setItem(prefix + slug, v);
          localStorage.removeItem(prefix + id);
        }
      });
      try {
        const raw = localStorage.getItem('mmgr_admin_projects');
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            let changed = false;
            list.forEach(function (p) {
              if (p && p.id === id) {
                p.id = slug;
                if (p.file) {
                  p.file = 'project.html?id=' + encodeURIComponent(slug);
                }
                changed = true;
              }
            });
            if (changed) {
              localStorage.setItem('mmgr_admin_projects', JSON.stringify(list));
            }
          }
        }
      } catch (e) {
        /* admin list is optional */
      }
      localStorage.setItem('mmgr_current_project', slug);
      localStorage.setItem('mmgr_cloud_id_' + slug, id); // keep the cloud twin reachable
      if (!urlParams.get('id')) {
        window.location.replace(
          'project.html?id=' + encodeURIComponent(slug) + window.location.hash
        );
      }
    } catch (e) {
      /* migration must never block boot */
    }
  })();

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
      if (!raw) {
        return false;
      }
      const list = JSON.parse(raw);
      return (
        Array.isArray(list) &&
        list.some(function (p) {
          return p && p.id === id;
        })
      );
    } catch (e) {
      return false;
    }
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
      ns.scope = locallyOwned
        ? 'full'
        : localStorage.getItem('mmgr_scope_' + projectId) === 'readonly'
          ? 'readonly'
          : 'full';
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
        // C19: a CLIENT code is read-only exactly like a viewer code - the
        // scope machinery (READONLY_SAFE_ACTIONS) treats both identically,
        // and the section grant is enforced by applyClientScope hiding nav.
        if (es && Array.isArray(es.sections) && (es.role === 'view' || es.role === 'client')) {
          ns.scope = 'readonly';
        }
      } catch (e) {
        /* ignore */
      }
    }
    return true;
  }

  function isReadonly() {
    return ns.scope === 'readonly';
  }

  // PART F T9 (no-offline-copy guarantee): TRUE when this project was opened
  // with a cloud editor/viewer code (session escope role set , the same slot
  // mmgr-cloud.js writes). A recipient must never be able to export the
  // project as an offline-copyable file: the server enforces scope on writes,
  // but export runs entirely client-side, so the UI must refuse it here.
  function cloudCodeHeld() {
    try {
      const es = JSON.parse(sessionStorage.getItem('mmgr_cloud_escope_' + ns.projectId) || 'null');
      // C19: clients are recipients like editors/viewers - offline exports
      // stay blocked for them too.
      return !!(es && (es.role === 'editor' || es.role === 'view' || es.role === 'client'));
    } catch (e) {
      return false;
    }
  }
  function cloudExportBlocked(action) {
    // openOM (export modal), cpOut (copy JSON), saveProjectFile (download
    // .json) and driveBackup (writes the workspace to the recipient's own
    // Drive) are the offline-copy surfaces , refused while a share code is
    // held. Everything else proceeds normally.
    if (
      action !== 'openOM' &&
      action !== 'cpOut' &&
      action !== 'saveProjectFile' &&
      action !== 'driveBackup'
    ) {
      return false;
    }
    if (!cloudCodeHeld()) {
      return false;
    }
    if (window.MMGR.App && typeof window.MMGR.App.showToast === 'function') {
      window.MMGR.App.showToast(
        'Shared projects can\u2019t be copied offline. This project was opened with a share code.',
        'err'
      );
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
      if (dropdown) {
        dropdown.style.display = 'none';
        dropdown.innerHTML = '';
      }
      _mentionIdx = -1;
    }

    function renderMentionItems(dropdown, matches) {
      _mentionIdx = -1;
      // Stakeholder names are user-entered (RACI people) - escape fully so a
      // name containing markup can never inject HTML into the dropdown.
      const esc = s =>
        String(s)
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      dropdown.innerHTML = matches
        .map(
          (n, i) =>
            '<div class="mention-item" role="option" aria-selected="false" style="padding:7px 10px;cursor:pointer;font-size:.75rem;border-bottom:1px solid var(--border);transition:background .1s" data-name="' +
            esc(n) +
            '" data-idx="' +
            i +
            '">' +
            '<span style="color:var(--gold);font-weight:600">@</span> ' +
            esc(n) +
            '</div>'
        )
        .join('');
    }

    document.addEventListener('input', function (e) {
      if (!e.target.id || !e.target.id.startsWith('comment-input-')) {
        return;
      }
      const input = e.target;
      const val = input.value;
      const atIdx = val.lastIndexOf('@');
      const dropdown = document.getElementById('mention-dropdown');
      if (!dropdown) {
        return;
      }

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
    document.addEventListener('keydown', function (e) {
      if (!e.target.id || !e.target.id.startsWith('comment-input-')) {
        return;
      }
      const dropdown = document.getElementById('mention-dropdown');
      if (!dropdown || dropdown.style.display === 'none') {
        return;
      }
      const items = dropdown.querySelectorAll('.mention-item');
      if (!items.length) {
        return;
      }

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

    document.addEventListener('click', function (e) {
      if (e.target.classList.contains('mention-item')) {
        const name = e.target.getAttribute('data-name');
        const input = e.target.closest('.card')
          ? e.target.closest('.card').querySelector('input[id^="comment-input-"]')
          : null;
        if (input && name) {
          selectMention(input, name);
        }
      }
    });

    document.addEventListener(
      'blur',
      function (e) {
        if (e.target.id && e.target.id.startsWith('comment-input-')) {
          setTimeout(function () {
            const dropdown = document.getElementById('mention-dropdown');
            if (dropdown) {
              dropdown.style.display = 'none';
              _mentionIdx = -1;
            }
          }, 200);
        }
      },
      true
    );
  }

  function init() {
    if (!checkAccess()) {
      return;
    }

    ns.State.load();

    const s = S();

    // Task 6 (owner 2026-09-19): background assistant. One immediate pass,
    // then every 60s while the app is open. Zero-throw, zero network; the
    // watchers read local state only. Premium gate lands inside the
    // Entitlements seam later - run() will consult it then.
    if (ns.Watch) {
      try {
        ns.Watch.run();
      } catch (e) {
        /* never block boot */
      }
      setInterval(function () {
        try {
          ns.Watch.run();
        } catch (e) {}
      }, 60000);
    }

    // ACTION-PLAN 4.1: view-only scope , reduced read-only view. The body
    // class + banner are the visible state; the delegated event guards below
    // block every mutating data-action, while navigation / Copy All / Print
    // keep working.
    if (isReadonly()) {
      document.body.classList.add('readonly-mode');
      const banner = U.$('readonly-banner');
      if (banner) {
        banner.classList.remove('is-hide');
      }
    }

    // Apply theme: the device-level pref (localStorage mmgr_theme - the same
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
    try {
      theme = localStorage.getItem('mmgr_theme') || theme;
    } catch (e) {
      /* ignore */
    }
    const dark =
      theme === 'dark' ||
      (theme === 'system' &&
        window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.classList.toggle('dark-mode', dark);
    if (thmTgl) {
      thmTgl.checked = !dark;
    }
    // Apply crosshair
    if (s.crosshairOn) {
      document.body.classList.add('crosshair-on');
      const tgl = U.$('ch-tgl');
      if (tgl) {
        tgl.checked = true;
      }
    }
    // Crosshair alignment lines (#cx horizontal, #cy vertical) follow the
    // pointer. Monolith parity: bound once at init, CSS hides the lines when
    // the toggle is off.
    const cxEl = U.$('cx');
    const cyEl = U.$('cy');
    if (cxEl && cyEl) {
      document.addEventListener('mousemove', function (ev) {
        cxEl.style.top = ev.clientY + 'px';
        cyEl.style.left = ev.clientX + 'px';
      });
    }
    // Persisted focus mode (monolith S.focus parity)
    if (s.focusMode) {
      document.body.classList.add('focus-mode');
    }
    // Set user name
    const nameIn = U.$('user-name-in');
    if (nameIn) {
      nameIn.value = s.userName || '';
    }

    // Set work week
    const ww = U.$('ww-sel');
    if (ww) {
      ww.value = s.workWeek || 5;
    }

    // Load charter data
    ns.Charter && ns.Charter.loadCharterData();

    // Load sprint data
    ns.Sprint && ns.Sprint.loadSprintData();

    // Load budget envelope
    const env = U.$('bud-envelope');
    if (env) {
      env.value = s.budgetEnvelope || 0;
    }

    // SIDEBAR-HAMBURGER-TOGGLE-PLAN: build the desktop sidebar (a clone of
    // the .sec-nav groups) BEFORE the first render so the pack/methodology
    // gates land on both navs together; then boot the rail open and install
    // the drawer/sidebar dismiss bindings.
    buildSidebar();
    // OWNER 2026-08-15: the sidebar IS the view on desktop , boot the pinned
    // rail OPEN (body.sidebar-open). Mobile keeps the off-canvas drawer
    // (sidebar-open is never set there, so the scrim can't flash at boot).
    if (window.innerWidth > 768) {
      document.body.classList.add('sidebar-open');
    }
    syncSidebarChrome();
    bindNavDismiss();

    // Initial render
    R.renderAll();
    updateUndoUi();

    // DIR-2 (PROJECT-UX-NAV-WEATHER-EXPORT-DIRECTIVE): measure the header so
    // the sticky section nav sits exactly below it; re-measure on resize (the
    // header wraps on narrow screens).
    // PROD AUDIT 2026-09-16: the boot-time measurement can land before the
    // webfont swap settles (mobile saw --hdr-h 216px vs real 201px), and the
    // fixed sidebar/#ai-win then sit below their true slot until a resize
    // happens to re-measure. Re-measure when fonts finish loading and once
    // more after full load; both are cheap no-ops when the height is stable.
    // SECOND PASS (same audit): fonts.ready can resolve BEFORE the late
    // render that first requests the webfont, so event-order guessing still
    // loses. A ResizeObserver on the header is by-construction: ANY height
    // change, whenever it happens, re-publishes --hdr-h. The consumers
    // (sidebar/sec-nav/#ai-win offsets) never affect the header's own size,
    // so there is no feedback loop.
    if (ns.Viewport && ns.Viewport.syncHeaderStack) {
      ns.Viewport.syncHeaderStack();
      window.addEventListener('resize', function () {
        ns.Viewport.syncHeaderStack();
      });
      window.addEventListener('load', function () {
        ns.Viewport.syncHeaderStack();
      });
      if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
        document.fonts.ready.then(function () {
          ns.Viewport.syncHeaderStack();
        });
      }
      if (window.ResizeObserver) {
        var hdrStackEl = document.getElementById('app-header');
        if (hdrStackEl) {
          var hdrRO = new ResizeObserver(function () {
            ns.Viewport.syncHeaderStack();
          });
          hdrRO.observe(hdrStackEl);
        }
      }
    }

    // Phase 2: hook the client error surface (window error + unhandledrejection)
    if (ns.Errors && ns.Errors.hookGlobals) {
      ns.Errors.hookGlobals();
    }

    // Rank 4.2: crash-durability journal restore , if the IndexedDB journal
    // holds a NEWER state than localStorage (a hard kill happened mid-edit),
    // adopt it and re-render. Async best-effort; never blocks first paint.
    ns.State.restoreFromJournal().then(function (restored) {
      if (restored) {
        R.renderAll();
      }
    });

    // Populate weather region selector + set current value
    const regSel = U.$('weather-region-sel');
    if (regSel && ns.Weather && ns.Weather.getRegions) {
      regSel.innerHTML = ns.Weather.getRegions()
        .map(
          r =>
            '<option value="' +
            U.escapeHtml(r.id) +
            '"' +
            (r.id === (s.weatherRegion || 'northern-temperate') ? ' selected' : '') +
            '>' +
            U.escapeHtml(r.name) +
            '</option>'
        )
        .join('');
    }

    // Live dirty indicator: any state change (typing, toggles, imports)
    // updates the header badge immediately without a full re-render.
    ns.State.onChange(function () {
      R.renderDirtyIndicator();
    });

    // OWNER 2026-08-15: background cloud auto-sync , once the user goes
    // idle (~25s), a cloud-linked project's snapshot is pushed silently so
    // the header's green "Cloud backed up" chip stays honest. No-op for
    // unlinked / editor-only / readonly projects (Cloud.autoSaveToCloud
    // guards on the owner credential). The timer resets on every edit.
    ns.State.onChange(function () {
      scheduleCloudAutoSave();
    });

    // Multi-tab conflict detection: storage events fire in OTHER tabs, so
    // this tab is notified whenever a peer overwrites the shared key.
    window.addEventListener('storage', function (e) {
      if (!ns.State.getProjectKey || e.key !== ns.State.getProjectKey() || !e.newValue) {
        return;
      }
      try {
        onExternalChange(JSON.parse(e.newValue));
      } catch (err) {
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
    document.addEventListener('keydown', function (e) {
      // Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo (not inside text inputs,
      // where the browser owns undo).
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        const inInput = e.target.closest && e.target.closest('input,textarea,select');
        if (!inInput) {
          e.preventDefault();
          // VIEW-ONLY HARDENING: undo/redo rewrite project state - refused
          // in read-only sessions like every other mutation.
          if (isReadonly()) {
            showToast('View-only access: history is disabled.', 'err');
            return;
          }
          if (e.shiftKey) {
            redo();
          } else {
            undo();
          }
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
        const pm = document.getElementById('pool-modal');
        if (pm) {
          pm.remove();
        }
        const im = document.getElementById('import-modal');
        if (im) {
          im.remove();
        }
        if (ns.Bids && ns.Bids.closeBidPkgModal) {
          ns.Bids.closeBidPkgModal();
        }
        if (ns.Charter) {
          ns.Charter.closeChartUp();
        }
        if (ns.WbsImport) {
          ns.WbsImport.closeWbsImport();
        }
        if (ns.ImportDates) {
          ns.ImportDates.closeImportDates();
        }
        if (ns.AiWin) {
          ns.AiWin.close();
        }
      }
    });

    // PLAN-OF-ACTION-LIQUID-GLASS-UI 3.5.2/3.5.4: apply the glass engine on
    // boot if the device preference + capability floor allow it. Also sync
    // the settings toggle's checked state to the stored preference. The
    // engine is dynamically imported and only then , zero cost otherwise.
    if (ns.Viewport && ns.Viewport.getGlassMode) {
      const gt = U.$('glass-tgl');
      if (gt) {
        gt.checked = ns.Viewport.getGlassMode() === 'premium';
      }
    }
    if (ns.Glass && ns.Glass.sync) {
      ns.Glass.sync();
    }

    // DIR-1b: reflect the device-level remote-error-reporting preference
    // (localStorage slot, like the glass mode toggle above , never project
    // state) into the Controls drawer controls on boot.
    if (ns.Errors && ns.Errors.getReportCfg) {
      const rc = ns.Errors.getReportCfg();
      const rt = U.$('err-report-tgl');
      if (rt) {
        rt.checked = !!rc.enabled;
      }
      const rw = U.$('err-webhook');
      if (rw && rw.value !== rc.url) {
        rw.value = rc.url;
      }
    }

    // Rank 4.5: render the optional sync identity section (device label,
    // never a gate) into the Controls drawer.
    if (ns.Sync && ns.Sync.renderSyncSection) {
      ns.Sync.renderSyncSection();
    }

    // GOOGLE-DRIVE-BACKUP: render the optional Drive backup/restore section
    // into the Controls drawer (project.html only , app.html uses its
    // auth-bar controls). Same zero-throw guard as the sync section above.
    if (ns.GoogleAuth && ns.GoogleAuth.renderDriveSection) {
      ns.GoogleAuth.renderDriveSection();
    }

    // CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 1: render the optional Cloud
    // Backup (D1 + R2 owner-code storage) section into the Controls drawer.
    // Strictly additive and never gating , the module no-ops without
    // #cloud-section (project.html only), and the Worker API absence degrades
    // to a quiet "unavailable here" note.
    if (ns.Cloud && ns.Cloud.render) {
      ns.Cloud.render();
    }

    // C23 CLOUD SHARED RESOURCE POOL (Phase 6): pull-merge linked pool
    // rows into the Resources panel on boot when a credential is held.
    // Strictly additive and never gating (offline / unlinked = no-op).
    if (ns.Pool && ns.Pool.bootMerge) {
      ns.Pool.bootMerge();
    }

    // Run validation
    const issues = ns.State.validate();
    if (issues.length > 0) {
      console.warn('State validation issues:', issues);
    }

    console.log(
      'My MaNaGeR initialized. Project:',
      ns.projectId,
      '| Schema v' + ns.State.SCHEMA_VERSION
    );
  }

  // ---- Theme & Settings ----
  function setUserName(name) {
    ns.State.updateState(function (s) {
      s.userName = name;
    });
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
    try {
      localStorage.setItem('mmgr_theme', theme);
    } catch (e) {
      /* ignore */
    }
    if (!isReadonly()) {
      ns.State.updateState(function (s) {
        s.theme = theme;
      });
    }
    // Rank 3.5: keep the premium glass shader's dark flag in step with the
    // theme (a toggle between light/dark must not leave a stale backdrop).
    if (ns.Glass && ns.Glass.refreshTheme) {
      ns.Glass.refreshTheme();
    }
  }

  // ---- PLAN-OF-ACTION-LIQUID-GLASS-UI 3.5.3: Premium visual mode toggle ----
  // A single, clearly-labeled settings toggle, off by default, persisted to
  // the shared device-preference slot (localStorage , NOT project state, so
  // it can never travel in the .json export). Never a popup or forced
  // prompt. The capability floor (Viewport.effectiveGlassMode) overrides the
  // stored preference: a low-end device stays on CSS glass no matter what.
  // OWNER 2026-09-06: the Premium Glass toggle UI is retired - Performance
  // Mode (mmgr-perf.js) is the single user-facing lever for heavy layers.
  // The action stays mapped as a no-op so stale dispatches cannot error.
  function tglGlassMode() {}

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
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
    }
  }
  // Dismiss bindings are installed once at init (not lazily on first click),
  // so Escape/resize/section-click always close the drawer AND the desktop
  // sidebar overlay even when the pref opened the sidebar at boot without a click.
  function bindNavDismiss() {
    if (_navBound) {
      return;
    }
    _navBound = true;
    document.addEventListener('click', function (e) {
      const t = e.target;
      // Section buttons close the mobile drawer; on desktop the pinned rail
      // stays open (the hamburger is its close control).
      if (t && t.closest && t.closest('.sec-btn')) {
        closeNav();
      }
      // Outside-click closes the backup popover (not on the indicator itself
      // or anything inside the popover).
      const pop = U.$('bk-pop');
      if (
        pop &&
        !pop.hidden &&
        !(t && t.closest && (t.closest('#bk-pop') || t.closest('#dirty-ind')))
      ) {
        bkClose();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') {
        return;
      }
      closeNav();
      bkClose();
      // Escape also closes the desktop pinned rail , full-screen work, the
      // hamburger reopens it.
      if (window.innerWidth > 768 && document.body.classList.contains('sidebar-open')) {
        setSidebarOpen(false);
      }
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
      if (btn) {
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      // BUG-10: the mobile off-canvas drawer is the same overflow scroll
      // container as the desktop sidebar , reset it to the top on open too,
      // so the first section is always the first thing visible.
      if (open) {
        const nav = U.$('sec-nav');
        if (nav) {
          nav.scrollTop = 0;
        }
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
  function readDevicePref(key) {
    return ns.AppSidebar ? ns.AppSidebar.readDevicePref(key) : null;
  }
  function writeDevicePref(key, v) {
    if (ns.AppSidebar) {
      ns.AppSidebar.writeDevicePref(key, v);
    }
  }
  function sidebarEnabled() {
    return true;
  }
  function syncSidebarChrome() {
    if (ns.AppSidebar) {
      ns.AppSidebar.syncSidebarChrome();
    }
  }
  function setSidebarOpen(open) {
    if (ns.AppSidebar) {
      ns.AppSidebar.setSidebarOpen(open);
    }
  }
  function toggleSidebar() {
    if (ns.AppSidebar) {
      ns.AppSidebar.toggleSidebar();
    }
  }
  function pushSidebarBackend(on) {
    if (ns.AppSidebar) {
      ns.AppSidebar.pushSidebarBackend(on);
    }
  }
  function pullSidebarBackend() {
    if (ns.AppSidebar) {
      ns.AppSidebar.pullSidebarBackend();
    }
  }
  function buildSidebar() {
    if (ns.AppSidebar) {
      ns.AppSidebar.buildSidebar();
    }
  }

  // ---- PLAN-OF-ACTION-AI-VOICE-SYNC-v1 4.5: optional Google identity ----
  function syncConnect() {
    if (ns.Sync && ns.Sync.connect) {
      ns.Sync.connect();
    }
  }
  function syncSignOut() {
    if (ns.Sync && ns.Sync.signOut) {
      ns.Sync.signOut();
    }
  }
  function syncClientId(el) {
    if (ns.Sync && ns.Sync.setClientId) {
      ns.Sync.setClientId(el);
    }
  }
  function syncDismissSuggest() {
    if (ns.Sync && ns.Sync.dismissSuggestion) {
      ns.Sync.dismissSuggestion();
    }
  }

  // OWNER 2026-09-06: #siom sign-in sheet helpers (sidebar-bottom Sign in
  // row). Mirrors app.html's openSignIn/closeSignIn; GIS re-renders on open
  // because a button drawn while the sheet is hidden comes out 0x0.
  function openSignInModal() {
    const m = U.$('siom');
    if (m) {
      m.classList.add('open');
      try {
        const G = ns.GoogleAuth;
        if (G && G.ensureGisButton) {
          G.ensureGisButton();
        }
      } catch (e) {
        /* GIS quirk - the fallback button still shows */
      }
      const f = m.querySelector('.email-auth-input');
      if (f && f.focus) {
        try {
          f.focus();
        } catch (e) {}
      }
      return;
    }
    // SIGN-IN FALLBACK (owner 2026-09-20): project.html ships no #siom sheet,
    // so callers there previously hit a silent dead end. The drawer's cloud
    // section carries the real sign-in surface (email + Google button), so
    // open it, land on the Controls tab, and bring the sign-in button into
    // view instead of dying.
    const C = window.MMGR && window.MMGR.Cloud;
    const drw = U.$('drw');
    if (!drw) {
      return;
    }
    drw.classList.add('open');
    const tabBtn = document.querySelector('.dtab[data-tab="ctrl"]');
    if (tabBtn) {
      swDtab('ctrl', tabBtn);
    }
    if (C && C.render) {
      try {
        C.render();
      } catch (e) {
        /* section keeps its last state */
      }
    }
    const focusCloudSignin = function () {
      const btn = document.querySelector('#ctrl-share [data-action="cloudSignIn"]');
      if (btn) {
        try {
          btn.scrollIntoView({ block: 'center', behavior: 'auto' });
        } catch (e) {
          try {
            btn.scrollIntoView();
          } catch (e2) {}
        }
        try {
          btn.focus();
        } catch (e) {}
      }
    };
    requestAnimationFrame(function () {
      focusCloudSignin();
      setTimeout(focusCloudSignin, 350);
    });
  }
  function closeSignInModal() {
    const m = U.$('siom');
    if (m) {
      m.classList.remove('open');
    }
  }

  function tglCh() {
    const tgl = U.$('ch-tgl');
    const on = tgl && tgl.checked;
    document.body.classList.toggle('crosshair-on', on);
    ns.State.updateState(function (s) {
      s.crosshairOn = on;
    });
  }

  // ---- Phase 2: feature flags ----
  // Checkbox-driven (same contract as theme/crosshair): Chrome toggles
  // `checked` before the handler runs, so read it as-is and let the native
  // toggle stand. state.flags drives the Controls-drawer chips and the
  // render-side UI gating (renderFlags in mmgr-render.js).
  function tglFlag(el) {
    const flag = el.getAttribute('data-flag');
    if (!flag) {
      return;
    }
    const on = el.type === 'checkbox' ? el.checked : S().flags && S().flags[flag] !== false;
    ns.State.updateState(function (s) {
      if (!s.flags || typeof s.flags !== 'object') {
        s.flags = {};
      }
      s.flags[flag] = on;
    });
    R.renderAll();
  }

  // ---- Phase 2: client error surface ----
  function clearErrorLog() {
    if (ns.Errors && ns.Errors.clear) {
      ns.Errors.clear();
    }
    showToast('Error log cleared.', 'ok');
  }

  // ---- DIR-1a: error log export (Copy / Download) ----
  // Consumes ns.Errors.getLog() , the single data source. Plain-text format
  // matches the drawer's ts / action / msg columns. Zero network calls.
  function errLogText() {
    // Single source of truth: ns.Errors.formatEntry shares the drawer's ts
    // formatter (mmgr-errors.js fmtTs), so the exported log can never drift
    // from the on-screen log.
    const entries = ns.Errors && ns.Errors.getLog ? ns.Errors.getLog() : [];
    const fmt =
      ns.Errors && ns.Errors.formatEntry
        ? ns.Errors.formatEntry
        : function (en) {
            return String(en.msg);
          };
    return entries.map(fmt).join('\n');
  }

  async function copyErrorLog() {
    const text = errLogText();
    if (!text) {
      showToast('Error log is empty.', 'warn');
      return;
    }
    // U.copyToClipboard never rejects (clipboard API + execCommand fallback
    // both resolve true), so no catch is needed , a successful copy is the
    // only path that reaches the success toast.
    await U.copyToClipboard(text);
    showToast('Error log copied.', 'ok');
  }

  function downloadErrorLog() {
    const text = errLogText();
    if (!text) {
      showToast('Error log is empty.', 'warn');
      return;
    }
    try {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mymanager-error-log-' + new Date().toISOString().slice(0, 10) + '.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
      }, 400);
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
    showToast(
      _reportCtx
        ? 'Report will include project context (names + budget totals).'
        : 'Report is counts-only (sanitized).',
      _reportCtx ? 'warn' : 'ok'
    );
  }

  async function reportIssueCopy() {
    if (!ns.Report || typeof ns.Report.copyPackage !== 'function') {
      showToast('Report module unavailable.', 'err');
      return;
    }
    const ok = await ns.Report.copyPackage(_reportCtx);
    showToast(
      ok ? 'Report copied , paste it wherever you file the issue.' : 'Could not copy the report.',
      ok ? 'ok' : 'err'
    );
  }

  function reportIssueDownload() {
    if (!ns.Report || typeof ns.Report.downloadPackage !== 'function') {
      showToast('Report module unavailable.', 'err');
      return;
    }
    showToast(
      ns.Report.downloadPackage(_reportCtx)
        ? 'Report downloaded.'
        : 'Could not download the report.',
      'ok'
    );
  }

  // ---- DIR-1b: opt-in remote error reporting ----
  // Device-level preference (localStorage, never project state), off by
  // default. The actual POST lives in mmgr-errors.js (routed through
  // MMGR.Net's circuit-breaker). These handlers only move the toggle/URL.
  function tglErrReport() {
    const tgl = U.$('err-report-tgl');
    const on = tgl ? tgl.checked : false;
    if (ns.Errors && ns.Errors.setReportCfg) {
      ns.Errors.setReportCfg({ enabled: on });
    }
    showToast(
      on
        ? 'Remote error reporting ON , new errors are posted to your webhook.'
        : 'Remote error reporting OFF , errors stay on this device only.',
      on ? 'ok' : 'warn'
    );
  }

  function setErrWebhook(el) {
    if (ns.Errors && ns.Errors.setReportCfg) {
      ns.Errors.setReportCfg({ url: el.value });
    }
  }

  function tglLock() {
    ns.State.updateState(function (s) {
      s.methodologyLocked = !s.methodologyLocked;
    });
    R.renderLock();
  }

  function setWorkWeek(val) {
    ns.State.updateState(function (s) {
      s.workWeek = parseInt(val) || 5;
    });
  }

  // ---- Methodology ----
  function swMeth(meth, btn) {
    const s = S();
    if (s && s.methodologyLocked) {
      showToast('Methodology is locked. Unlock in Controls to switch.', 'err');
      return;
    }
    ns.State.updateState(function (state) {
      state.methodology = meth;
    });
    R.renderMethodology();
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) {
      btn.classList.add('active');
    }
  }

  // ---- Sections ----
  function showSec(section, btn) {
    R.showSection(section, btn);
  }

  // ---- Focus Mode ----
  function tglFocusMode() {
    // Monolith parity: the focus state persists so a hard refresh keeps the
    // focused workspace (S.focus in the monolith).
    ns.State.updateState(function (s) {
      s.focusMode = !s.focusMode;
    });
    document.body.classList.toggle('focus-mode', !!S().focusMode);
  }

  // ---- Drawer ----
  function openDrw() {
    const drw = U.$('drw');
    if (drw) {
      drw.classList.add('open');
    }
  }

  function closeDrw() {
    const drw = U.$('drw');
    if (drw) {
      drw.classList.remove('open');
    }
  }

  function swDtab(tab, btn) {
    document.querySelectorAll('.dtab').forEach(b => b.classList.remove('active'));
    if (btn) {
      btn.classList.add('active');
    }
    ['feat', 'qa', 'prompt', 'ctrl'].forEach(t => {
      const el = U.$('db-' + t);
      if (el) {
        el.classList.toggle('is-hide', t !== tab);
      }
    });
    // M-2: the Controls tab carries the account-delete block; render it on
    // first open so a session restored before this drawer existed shows it.
    if (tab === 'ctrl') {
      renderDataAccount();
    }
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
      requestAnimationFrame(function () {
        try {
          el.scrollIntoView({ block: 'center', behavior: 'auto' });
        } catch (e) {
          el.scrollIntoView();
        }
        // Keyboard users land on a focused control, not a blind tab-through.
        const firstPack = U.$('pk-schedule');
        if (firstPack) {
          try {
            firstPack.focus({ preventScroll: true });
          } catch (e2) {
            /* ignore */
          }
        }
      });
    }
  }

  // DIR-3: dismiss the Core-Mode nudge forever for this project.
  function dismissPacksCallout() {
    ns.State.updateState(function (s) {
      s.packsCalloutDismissed = true;
    });
    if (ns.Render && ns.Render.renderCoreCallout) {
      ns.Render.renderCoreCallout();
    }
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
    if (window.MMGR && MMGR.Components && MMGR.Components.showToast) {
      MMGR.Components.showToast(msg, type, action);
    }
  }

  // ---- Methodology Learning Card ----
  let mlcTimer = null;
  const MLC_DATA = {
    waterfall: {
      title: 'Waterfall Methodology',
      body: 'A linear, sequential approach where each phase must be completed before the next begins. Best for construction, manufacturing, and regulated environments where requirements are stable and changes are costly.',
      when: 'Best for: Fixed-price contracts, regulatory projects, and any project where the full scope is known upfront.',
      example:
        'Example: Building a bridge , design must be approved before steel is ordered, and steel must arrive before erection begins.'
    },
    agile: {
      title: 'Agile Methodology',
      body: 'An iterative approach that delivers work in small, time-boxed increments called sprints. Best for software, product development, and environments where requirements evolve rapidly.',
      when: 'Best for: Projects with evolving requirements, innovation work, and teams that benefit from rapid feedback loops.',
      example:
        'Example: Developing a mobile app , each 2-week sprint delivers a working feature set that users can test and provide feedback on.'
    },
    hybrid: {
      title: 'Hybrid Methodology',
      body: 'Combines the structure of Waterfall (planning, design, governance) with the flexibility of Agile (iterative delivery, continuous improvement). Best for complex projects that need both certainty and adaptability.',
      when: 'Best for: Large-scale digital transformations, capital projects with software components, and any project where parts are well-defined and parts are exploratory.',
      example:
        'Example: A factory automation project , the physical layout and equipment procurement follow Waterfall, while the control software is developed in Agile sprints.'
    }
  };

  function showMLC(meth) {
    const data = MLC_DATA[meth];
    if (!data) {
      return;
    }
    const card = U.$('meth-learn-card');
    if (!card) {
      return;
    }
    U.$('mlc-title').textContent = data.title;
    U.$('mlc-body').textContent = data.body;
    U.$('mlc-when').textContent = data.when;
    U.$('mlc-example').textContent = data.example;
    card.classList.remove('is-hide');
  }

  function closeMLC() {
    const card = U.$('meth-learn-card');
    if (card) {
      card.classList.add('is-hide');
    }
  }

  function scheduleMLCClose() {
    if (mlcTimer) {
      clearTimeout(mlcTimer);
    }
    mlcTimer = setTimeout(closeMLC, 500);
  }

  function clearMlcTimer() {
    if (mlcTimer) {
      clearTimeout(mlcTimer);
    }
  }

  // ---- Copy All / Export Text ---- (extracted to js/app/copy-text.js)
  function cpAllPage(section) {
    if (ns.AppCopy) {
      ns.AppCopy.cpAllPage(section);
    }
  }
  function buildDigest(s) {
    return ns.AppCopy ? ns.AppCopy.buildDigest(s) : '';
  }
  function copyAsText(kind) {
    return ns.AppCopy ? ns.AppCopy.copyAsText(kind) : '';
  }
  function renderCtrlPreviews() {
    if (ns.AppCopy) {
      ns.AppCopy.renderCtrlPreviews();
    }
  }
  function cpFormats(kind) {
    if (ns.AppCopy) {
      ns.AppCopy.cpFormats(kind);
    }
  }
  function emailTplText(kind) {
    return ns.AppCopy ? ns.AppCopy.emailTplText(kind) : '';
  }
  function emailTpl(kind) {
    if (ns.AppCopy) {
      ns.AppCopy.emailTpl(kind);
    }
  }

  // ---- 5.2 Definitions tooltips ---- (extracted to js/app/definitions.js)
  function defTipFor(term) {
    return ns.AppDefs && ns.AppDefs.defTipFor ? ns.AppDefs.defTipFor(term) : null;
  }
  function showDefTip(el, term) {
    if (ns.AppDefs && ns.AppDefs.showDefTip) {
      ns.AppDefs.showDefTip(el, term);
    }
  }
  function hideDefTip() {
    if (ns.AppDefs && ns.AppDefs.hideDefTip) {
      ns.AppDefs.hideDefTip();
    }
  }

  // ---- 5.x Gantt high-res PNG export ----
  // Renders the CURRENT schedule to an offscreen 2x canvas and downloads it
  // as a large print-ready PNG. Client-side only; no server, no library.
  // READABILITY WAVE (owner 2026-09-26, external review of a real export):
  // today line, FS dependency connectors (critical chain highlighted so the
  // eye can follow WHY the schedule reads as it does), milestone diamonds,
  // phase header banding + phase tab strips, weekend column shading, a real
  // title block (project, window, export date, prepared by) and a legible
  // legend. Bars/critical/weather/baseline carry over unchanged.
  // ==== G6 (directive 2026-10-18): the export draws ONCE into a neutral
  // list of primitives {rect|line|text|poly}; PNG replays that list to a
  // canvas and SVG string-builds from the SAME list, so the two outputs can
  // never differ. Light (print) theme is the default - dark-only exports
  // waste ink and fail on projectors; the G8 dialog remembers the choices
  // in ui.ganttExport, and the zero-click default is a good export.
  function ganttExportOpts() {
    const s = ns.State.getState();
    const ui = s.ui || {};
    const saved = ui.ganttExport || {};
    const c = saved.columns || {};
    return {
      format: saved.format === 'svg' ? 'svg' : saved.format === 'pdf' ? 'pdf' : 'png',
      theme: saved.theme === 'dark' ? 'dark' : 'light',
      page: saved.page === 'a4' || saved.page === 'a3' ? saved.page : 'fit',
      // G5's key stays the source of truth for the link policy; the G8
      // dialog's "All links" switch writes it.
      links: ui.ganttLinkPolicy === 'all' ? 'all' : 'near',
      baseline: saved.baseline !== false,
      columns: {
        wbs: c.wbs !== false,
        task: true, // the task name is the one column that can never hide
        dur: c.dur !== false,
        start: c.start !== false,
        finish: c.finish !== false,
        pct: c.pct !== false,
        assignee: c.assignee !== false
      }
    };
  }

  function ganttTheme(name) {
    if (name === 'dark') {
      return {
        name: 'dark',
        bg: '#0e1116',
        title: '#f1f5f9',
        sub: '#94a3b8',
        bandMonth: '#cbd5e1',
        bandWeek: '#64748b',
        bandDay: '#94a3b8',
        weekend: 'rgba(148,163,184,.10)',
        weekline: 'rgba(255,255,255,.10)',
        dayTick: 'rgba(148,163,184,.45)',
        tableHead: '#94a3b8',
        tableText: '#cbd5e1',
        tableSep: 'rgba(148,163,184,.14)',
        phaseBand: 'rgba(148,163,184,.08)',
        groupBand: 'rgba(214,58,58,.10)',
        groupText: '#f8fafc',
        phaseText: '#f8fafc',
        taskText: '#e2e8f0',
        msLabel: '#cbd5e1',
        legendText: '#cbd5e1',
        // Phase summary bracket. The directive says "black"; on a dark
        // canvas black would vanish, so the bracket INVERTS (light on dark)
        // - the bracket SHAPE with end ticks + rolled-up dates is what
        // distinguishes a phase from a task, in both themes.
        bracket: '#e2e8f0',
        bracketDates: '#94a3b8',
        gold: '#d4af37',
        task: '#3b82f6',
        done: '#009b3a',
        due: '#f59e0b',
        over: '#D63A3A',
        barOutline: 'rgba(255,255,255,.6)',
        baseline: 'rgba(148,163,184,.35)',
        weatherFill: 'rgba(56,189,248,.25)',
        weatherLine: 'rgba(56,189,248,.8)',
        link: 'rgba(148,163,184,.28)',
        linkGold: 'rgba(212,175,55,.85)',
        linkArrow: 'rgba(148,163,184,.5)',
        linkArrowGold: 'rgba(212,175,55,.9)',
        today: '#D63A3A',
        todayLine: 'rgba(214,58,58,.9)'
      };
    }
    // Light (print) theme: white background, dark text, the critical gold
    // darkened to #a8870f so it survives ink and projectors.
    return {
      name: 'light',
      bg: '#ffffff',
      title: '#111827',
      sub: '#4b5563',
      bandMonth: '#374151',
      bandWeek: '#6b7280',
      bandDay: '#4b5563',
      weekend: 'rgba(15,23,42,.05)',
      weekline: 'rgba(15,23,42,.10)',
      dayTick: 'rgba(15,23,42,.35)',
      tableHead: '#374151',
      tableText: '#1f2937',
      tableSep: 'rgba(15,23,42,.12)',
      phaseBand: 'rgba(15,23,42,.04)',
      groupBand: 'rgba(185,28,28,.08)',
      groupText: '#7f1d1d',
      phaseText: '#111827',
      taskText: '#1f2937',
      msLabel: '#374151',
      legendText: '#374151',
      bracket: '#111111',
      bracketDates: '#4b5563',
      gold: '#a8870f',
      task: '#2563eb',
      done: '#15803d',
      due: '#b45309',
      over: '#b91c1c',
      barOutline: 'rgba(0,0,0,.5)',
      baseline: 'rgba(15,23,42,.28)',
      weatherFill: 'rgba(2,132,199,.18)',
      weatherLine: 'rgba(2,132,199,.7)',
      link: 'rgba(15,23,42,.35)',
      linkGold: 'rgba(168,135,15,.9)',
      linkArrow: 'rgba(15,23,42,.55)',
      linkArrowGold: 'rgba(168,135,15,.95)',
      today: '#b91c1c',
      todayLine: 'rgba(185,28,28,.85)'
    };
  }

  // One build pass -> neutral primitives. Everything the PNG used to draw
  // is here, plus G6: the left table (WBS / Task / Duration / Start /
  // Finish / % / Assignee), the phase summary bracket with rolled-up dates
  // (a phase is NEVER the same blue as a task again), and a progress fill
  // inside each bar. Progress is derived honestly from the data model,
  // which carries a status but no measured percentage: completed = 100%,
  // in-progress = the elapsed share of its own span (planned progress,
  // labelled as such in the legend), not started = empty.
  function buildGanttDrawList(o) {
    const s = ns.State.getState();
    const all = s.tasks || [];
    const tasks = all.filter(t => t.startDate && t.endDate);
    if (!tasks.length) {
      return null;
    }
    const T = ganttTheme(o.theme);
    const prims = [];
    const mctx = document.createElement('canvas').getContext('2d');
    const fontStr = (size, weight) => (weight || 400) + ' ' + size + 'px sans-serif';
    const tw = (str, size, weight) => {
      mctx.font = fontStr(size, weight);
      return mctx.measureText(str).width;
    };
    // C1 backstop: label truncation (binary search for the widest prefix
    // that fits) - static exports have no tooltips, so the full name stays
    // readable in the live view; the export stays unclipped.
    const trunc = (str, size, weight, maxW) => {
      str = String(str || '');
      if (tw(str, size, weight) <= maxW) {
        return str;
      }
      let lo = 0,
        hi = str.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (tw(str.slice(0, mid) + '...', size, weight) <= maxW) {
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }
      return str.slice(0, lo) + '...';
    };
    const hexA = (hex, a) => {
      const m = /^#([0-9a-f]{6})$/i.exec(hex);
      if (!m) {
        return hex;
      }
      const n = parseInt(m[1], 16);
      return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    };
    const rect = p => {
      prims.push(Object.assign({ type: 'rect' }, p));
    };
    const line = p => {
      prims.push(Object.assign({ type: 'line' }, p));
    };
    const text = p => {
      prims.push(Object.assign({ type: 'text' }, p));
    };
    const poly = p => {
      prims.push(Object.assign({ type: 'poly' }, p));
    };
    // G1 export layer (directive 2026-10-18): a phase displays its
    // CHILDREN's span, derived at export time - a static image must never
    // trust a stored phase date that an edit after Cascade left stale.
    const spanOf = {};
    tasks.forEach(t => {
      let span = null;
      if (t.isPhase && ns.Schedule && ns.Schedule.phaseSpan) {
        span = ns.Schedule.phaseSpan(t, all);
      }
      spanOf[t.id] = span || { start: t.startDate, end: t.endDate };
    });
    let minDate = null,
      maxDate = null;
    tasks.forEach(t => {
      const sp = spanOf[t.id];
      if (!minDate || sp.start < minDate) {
        minDate = sp.start;
      }
      if (!maxDate || sp.end > maxDate) {
        maxDate = sp.end;
      }
    });
    const rowH = 26,
      headerH = 96; // G4: title block + three header bands (month/week/day)
    // ---- G6 left table: fixed columns around a measured Task column.
    let maxLabelWidth = 0;
    all.forEach(t => {
      const w = tw(t.name || '', 11, 700);
      if (w > maxLabelWidth) {
        maxLabelWidth = w;
      }
    });
    const colDefs = [];
    if (o.columns.wbs) {
      colDefs.push({ key: 'wbs', label: 'WBS', w: 34, align: 'left' });
    }
    colDefs.push({
      key: 'task',
      label: 'Task',
      w: Math.min(Math.max(110, Math.ceil(maxLabelWidth) + 10), 240),
      align: 'left'
    });
    if (o.columns.dur) {
      colDefs.push({ key: 'dur', label: 'Duration', w: 48, align: 'left' });
    }
    if (o.columns.start) {
      colDefs.push({ key: 'start', label: 'Start', w: 66, align: 'left' });
    }
    if (o.columns.finish) {
      colDefs.push({ key: 'finish', label: 'Finish', w: 66, align: 'left' });
    }
    if (o.columns.pct) {
      colDefs.push({ key: 'pct', label: '%', w: 30, align: 'right' });
    }
    if (o.columns.assignee) {
      colDefs.push({ key: 'assignee', label: 'Assignee', w: 90, align: 'left' });
    }
    let colX = 8;
    colDefs.forEach(cd => {
      cd.x = colX;
      colX += cd.w;
    });
    // G7 first half: pick dayWidth from the window so the logical width
    // stays at most ~3,200px. The ladder (14 -> 7 -> 3 -> 1.5 px/day)
    // keeps any multi-year schedule inside the browser canvas limits at
    // scale 2; the guard in exportGanttPNG handles the residual.
    let dayWidth = 14;
    const padL = colX + 8; // G6: the table owns the left pad now
    const padR = 20,
      padT = 16,
      padB = 44; // C7: 2-line legend wrap headroom
    const phaseGap = 7; // breathing room before each phase row (chunking)
    const totalDays = U.daysBetween(minDate, maxDate) + 1;
    while (dayWidth > 1.5 && padL + totalDays * dayWidth + 320 > 3200) {
      dayWidth = dayWidth === 14 ? 7 : dayWidth === 7 ? 3 : 1.5;
    }
    // G2 row order: phases in state order, each followed by its children
    // sorted by start date then WBS position; tasks whose parent cannot be
    // resolved collect under an "Unassigned tasks" group at the END (an
    // orphan must never print above P0 again). No task is ever dropped.
    const ordered = [];
    const placed = new Set();
    const emitKids = parent => {
      const kids = tasks.filter(
        c =>
          !c.isPhase &&
          !placed.has(c.id) &&
          (String(c.parentId) === String(parent.id) || c.parentName === parent.name)
      );
      kids.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
      kids.forEach(k => {
        ordered.push(k);
        placed.add(k.id);
        emitKids(k);
      });
    };
    tasks
      .filter(t => t.isPhase)
      .forEach(ph => {
        ordered.push(ph);
        placed.add(ph.id);
        emitKids(ph);
      });
    const unassigned = tasks.filter(t => !placed.has(t.id));
    if (unassigned.length) {
      ordered.push({
        id: '__unassigned__',
        name: 'Unassigned tasks (' + unassigned.length + ')',
        isGroupHeader: true
      });
      unassigned.forEach(t => ordered.push(t));
    }
    // One-time notice in the APP (not the export): orphans are a data
    // problem the owner can fix, never something to silently drop.
    if (unassigned.length && !window.__mmgrUnassignedNoticeShown) {
      window.__mmgrUnassignedNoticeShown = true;
      showToast(
        unassigned.length + ' tasks have no phase. Move them into a phase or delete them.',
        'err'
      );
    }
    // WBS numbers for the table: phases 1,2,3; their children 1.1, 1.2 ...
    const wbsOf = new Map();
    let phNum = 0,
      chNum = 0;
    ordered.forEach(t => {
      if (t.isGroupHeader) {
        return;
      }
      if (t.isPhase) {
        phNum++;
        chNum = 0;
        wbsOf.set(t.id, String(phNum));
      } else if (phNum > 0) {
        chNum++;
        wbsOf.set(t.id, phNum + '.' + chNum);
      }
    });
    // Row geometry pass: y per task + phase gap before isPhase rows + phase
    // ownership for the tab strips (nearest preceding phase row).
    const rowY = new Map();
    const rowPhase = new Map();
    const rowById = new Map();
    let curPhase = null,
      phaseIdx = -1;
    const PHASE_TABS = [
      '#8b5cf6',
      '#f97316',
      '#0ea5e9',
      '#22c55e',
      '#eab308',
      '#ec4899',
      '#14b8a6',
      '#a855f7',
      '#64748b',
      '#d4af37'
    ];
    let y = padT + headerH;
    ordered.forEach(t => {
      if (t.isGroupHeader) {
        y += rowY.size ? phaseGap : 0;
        rowY.set(t.id, y);
        y += rowH;
        return;
      }
      if (t.isPhase) {
        phaseIdx++;
        curPhase = t;
        y += rowY.size ? phaseGap : 0;
      }
      rowY.set(t.id, y);
      rowPhase.set(t.id, {
        phase: curPhase,
        color: PHASE_TABS[Math.abs(phaseIdx) % PHASE_TABS.length]
      });
      rowById.set(t.id, t);
      y += rowH;
    });
    const W = padL + totalDays * dayWidth + padR;
    const H = y + padB;
    const X = d => padL + U.daysBetween(minDate, d) * dayWidth;
    // Background (a prim, so every renderer paints the same canvas)
    rect({ x: 0, y: 0, w: W, h: H, fill: T.bg });
    // Title block (owner review: project, window, export date, prepared by)
    text({
      x: 8,
      y: padT + 12,
      str: (s.projectName || 'Project') + ' - Schedule Export',
      size: 13,
      weight: 700,
      fill: T.title
    });
    text({
      x: 8,
      y: padT + 28,
      str:
        minDate +
        ' to ' +
        maxDate +
        '  |  ' +
        tasks.length +
        (unassigned.length ? ' rows, ' + unassigned.length + ' unassigned' : ' rows') +
        '  |  exported ' +
        new Date().toISOString().slice(0, 10) +
        (s.userName ? '  |  prepared by ' + s.userName : ''),
      size: 10,
      weight: 400,
      fill: T.sub
    });
    // Chart-area header + weekend shading + week-start dividers + day labels
    // C2 (directive): weekend FILL is separate from the Monday week-start
    // LINE - the old code conflated them into one Monday-only fill.
    // G4 (directive): three header bands - months (labelled at the first
    // VISIBLE day of each month, so a leading partial month is never
    // unlabelled), week-start dates, and day numbers only when they fit
    // (dayWidth >= 18) else ticks.
    const bandY = {
      month: padT + headerH - 44,
      week: padT + headerH - 30,
      day: padT + headerH - 14
    };
    let prevMonth = -1;
    for (let i = 0; i < totalDays; i++) {
      const d = U.addDays(minDate, i);
      const x = padL + i * dayWidth;
      const dow = d.getDay();
      if (dow === 0 || dow === 6) {
        rect({
          x: x,
          y: padT + headerH - 18,
          w: dayWidth,
          h: H - padT - headerH + 4,
          fill: T.weekend
        });
      }
      if (dow === 1) {
        line({
          x1: x + 0.5,
          y1: padT + headerH - 18,
          x2: x + 0.5,
          y2: H - padB,
          stroke: T.weekline,
          lw: 1
        });
        // Band 2: the week-start date. Only when it has room next door.
        if (dayWidth >= 7) {
          text({
            x: x + 1,
            y: bandY.week,
            str: String(d.getDate()),
            size: 9,
            weight: 400,
            fill: T.bandWeek
          });
        }
      }
      // Band 1: month label at the first VISIBLE day of the month.
      if (d.getMonth() !== prevMonth) {
        prevMonth = d.getMonth();
        text({
          x: x + 1,
          y: bandY.month,
          str: d.toLocaleString('default', { month: 'short' }) + ' ' + String(d.getFullYear()),
          size: 10,
          weight: 700,
          fill: T.bandMonth
        });
      }
      // Band 3: day numbers only when they fit; ticks otherwise.
      if (dayWidth >= 18) {
        text({
          x: x + 1,
          y: bandY.day,
          str: String(d.getDate()),
          size: 10,
          weight: 400,
          fill: dow === 0 || dow === 6 ? T.bandWeek : T.bandDay
        });
      } else if (dow === 1) {
        rect({ x: x, y: bandY.day - 4, w: 1, h: 4, fill: T.dayTick });
      }
    }
    // ---- G6 table header: column labels, an underline, and separators
    // that run the full height, so the export reads like every other
    // planning tool's left table.
    colDefs.forEach(cd => {
      text({
        x: cd.align === 'right' ? cd.x + cd.w - 4 : cd.x,
        y: bandY.week,
        str: cd.label,
        size: 9,
        weight: 700,
        fill: T.tableHead,
        align: cd.align
      });
    });
    line({ x1: 6, y1: bandY.day - 8, x2: padL - 8, y2: bandY.day - 8, stroke: T.tableSep, lw: 1 });
    colDefs.forEach((cd, ci) => {
      if (ci === 0) {
        return;
      }
      line({
        x1: cd.x - 2,
        y1: bandY.month - 6,
        x2: cd.x - 2,
        y2: H - padB,
        stroke: T.tableSep,
        lw: 1
      });
    });
    // Baseline map
    const baseMap = {};
    if (o.baseline && s.baseline && s.baseline.tasks) {
      (s.baseline.tasks || []).forEach(bt => {
        baseMap[bt.id] = bt;
      });
    }
    const todayStr = U.todayStr();
    const midY = id => rowY.get(id) + rowH / 2;
    // G5 (directive): links draw BEFORE the rows, so bars cover them - a
    // crossing line is context, never a rival signal. Policy: the critical
    // chain plus links spanning at most 8 rows ('near'); the G8 export
    // dialog flips ui.ganttLinkPolicy to 'all'. Each source routes its
    // vertical leg through its own lane, every link gets an arrowhead,
    // lag links draw DASHED, and the total is capped with an honest count.
    const linkPolicy = o.links;
    let linksDrawn = 0,
      linksHidden = 0;
    const laneBySource = {};
    function connector(pid, sid, gold) {
      const p = rowById.get(String(pid)),
        sRow = rowById.get(String(sid));
      if (!p || !sRow || !rowY.has(p.id) || !rowY.has(sRow.id)) {
        return;
      }
      // G1: connectors launch from the ROLLED-UP span too - a phase's
      // dependency leaves where its children actually end, not where a
      // stale stored date claims.
      const psp = spanOf[p.id] || { start: p.startDate, end: p.endDate };
      const ssp = spanOf[sRow.id] || { start: sRow.startDate, end: sRow.endDate };
      const y1 = midY(p.id),
        y2 = midY(sRow.id);
      // Policy: critical chain always; other links only when they stay
      // near (<= 8 rows) or the reader asked for all of them.
      if (!gold && linkPolicy !== 'all' && Math.abs(y2 - y1) / rowH > 8) {
        return;
      }
      if (linksDrawn >= 1500) {
        linksHidden++;
        return;
      }
      linksDrawn++;
      const lane = laneBySource[p.id] || 0;
      laneBySource[p.id] = lane + 1;
      const legX = x1For(psp) + 6 + 3 * (lane % 4);
      const x2 = X(ssp.start) - 3;
      const yEnd = x2 <= legX + 2 ? y2 + (y2 > y1 ? 4 : -4) : y2;
      line({
        x1: x1For(psp),
        y1: y1,
        x2: legX,
        y2: y1,
        stroke: gold ? T.linkGold : T.link,
        lw: gold ? 1.4 : 1
      });
      line({
        x1: legX,
        y1: y1,
        x2: legX,
        y2: yEnd,
        stroke: gold ? T.linkGold : T.link,
        lw: gold ? 1.4 : 1
      });
      line({
        x1: legX,
        y1: yEnd,
        x2: x2,
        y2: yEnd,
        stroke: gold ? T.linkGold : T.link,
        lw: gold ? 1.4 : 1,
        // Lag / overlap links (successor starts at or before the link
        // column) route below the predecessor row, DASHED.
        dash: x2 <= legX + 2 ? [4, 3] : undefined
      });
      // Arrowhead on EVERY link (G5) - a bare line end reads as a glitch.
      // The arrow points the way the link ENTERS: from the left on the
      // normal route, from the right when the lag leg sits past x2.
      const back = x2 <= legX + 2 ? 4 : -4;
      poly({
        pts: [
          [x2, yEnd],
          [x2 + back, yEnd - 3],
          [x2 + back, yEnd + 3]
        ],
        fill: gold ? T.linkArrowGold : T.linkArrow,
        close: true
      });
    }
    function x1For(sp) {
      return X(sp.end) + Math.max(3, U.daysBetween(sp.start, sp.end) * dayWidth + dayWidth * 0.2);
    }
    tasks.forEach(t =>
      (t.predecessors || []).forEach(pid =>
        connector(pid, t.id, !!(rowById.get(String(pid)) || {}).critical && !!t.critical)
      )
    );
    // G6: progress fill - honest derivation from the status field (the
    // model carries no measured percentage): completed fills the bar;
    // in-progress fills the ELAPSED share of its own span, which is
    // planned progress and says so in the legend; not started stays empty.
    const pctOf = (t, sp) => {
      if (t.status === 'completed') {
        return 100;
      }
      if (t.status !== 'in-progress') {
        return 0;
      }
      const spanDays = U.daysBetween(sp.start, sp.end) + 1;
      const elapsed = U.daysBetween(sp.start, todayStr) + 1;
      return Math.max(0, Math.min(100, Math.round((elapsed / Math.max(1, spanDays)) * 100)));
    };
    let progressFills = 0,
      phaseBrackets = 0;
    // Rows: table cells, bands, tabs, bars
    ordered.forEach(t => {
      const ry = rowY.get(t.id);
      const rowMid = ry + rowH / 2;
      if (t.isGroupHeader) {
        // G2: the "Unassigned tasks" divider row - a labelled band, no bar.
        rect({ x: padL, y: ry, w: W - padL - padR, h: rowH, fill: T.groupBand });
        const taskCol = colDefs.find(cd => cd.key === 'task') || colDefs[0];
        text({
          x: taskCol.x,
          y: rowMid + 3,
          str: t.name,
          size: 11,
          weight: 700,
          fill: T.groupText
        });
        return;
      }
      // G1: the bar draws the ROLLED-UP span - phases span their children,
      // derived at export time from phaseSpan, never the stored dates.
      const sp = spanOf[t.id] || { start: t.startDate, end: t.endDate };
      const x0 = X(sp.start);
      const bw = Math.max(3, U.daysBetween(sp.start, sp.end) * dayWidth + dayWidth * 0.2);
      if (t.isPhase) {
        rect({ x: padL, y: ry, w: W - padL - padR, h: rowH, fill: T.phaseBand });
      }
      const tab = rowPhase.get(t.id);
      if (tab) {
        rect({
          x: padL - 6,
          y: ry + 2,
          w: 3,
          h: rowH - 4,
          fill: hexA(tab.color, t.isPhase ? 0.9 : 0.55)
        });
      }
      // ---- G6 table cells (WBS / Task / Duration / Start / Finish / % /
      // Assignee), each truncated to its column.
      const durVal =
        t.duration !== undefined &&
        t.duration !== null &&
        t.duration !== '' &&
        isFinite(Number(t.duration))
          ? String(t.duration)
          : String(U.daysBetween(sp.start, sp.end) + 1);
      const pctVal = t.isPhase ? '' : String(pctOf(t, sp));
      const cell = {
        wbs: wbsOf.get(t.id) || '',
        dur: durVal,
        start: sp.start,
        finish: sp.end,
        pct: pctVal,
        assignee: t.assignedTo || ''
      };
      colDefs.forEach(cd => {
        if (cd.key === 'task') {
          return;
        }
        const v = String(cell[cd.key] || '');
        if (!v) {
          return;
        }
        const str = trunc(v, 9, 400, cd.w - 6);
        text({
          x: cd.align === 'right' ? cd.x + cd.w - 4 : cd.x,
          y: rowMid + 3,
          str: str,
          size: 9,
          weight: 400,
          fill: t.isPhase ? T.phaseText : T.tableText,
          align: cd.align
        });
      });
      const taskCol = colDefs.find(cd => cd.key === 'task') || colDefs[0];
      const indent = Math.min(4, Number(t.indent || t.level) || 0);
      text({
        x: taskCol.x + indent * 8,
        y: rowMid + 3,
        str: trunc(
          t.name || '',
          t.isPhase ? 11 : 10,
          t.isPhase ? 700 : 600,
          taskCol.w - indent * 8 - 4
        ),
        size: t.isPhase ? 11 : 10,
        weight: t.isPhase ? 700 : 600,
        fill: t.isPhase ? T.phaseText : T.taskText
      });
      const bt = baseMap[t.id];
      if (bt && bt.startDate && bt.endDate) {
        const bx = X(bt.startDate);
        const bww = Math.max(1, U.daysBetween(bt.startDate, bt.endDate)) * dayWidth;
        rect({ x: bx, y: ry + 3, w: bww, h: rowH - 10, fill: T.baseline });
      }
      if (t.weatherExposed) {
        rect({ x: x0, y: ry, w: bw, h: rowH, fill: T.weatherFill });
        for (let hx = x0; hx < x0 + bw; hx += 7) {
          line({ x1: hx, y1: ry, x2: hx + 7, y2: ry + rowH, stroke: T.weatherLine, lw: 1 });
        }
      }
      const col = t.critical
        ? T.gold
        : t.status === 'completed'
          ? T.done
          : U.isOverdue(sp.end) && t.status !== 'completed'
            ? T.over
            : U.isDueSoon(sp.end, 3) && t.status !== 'completed'
              ? T.due
              : T.task;
      // G3: a milestone is a milestone by FLAG or by SHAPE - a zero-duration
      // row (or a same-day row whose name reads as a gate/sign-off) draws as
      // a diamond, never a 3px sliver.
      const isMs =
        !!t.milestone ||
        Number(t.duration) === 0 ||
        (t.startDate === t.endDate &&
          /gate|sign-?off|complete|milestone|certificate/i.test(t.name || ''));
      if (isMs) {
        const cx = x0 + bw / 2,
          r = rowH / 2 - 4;
        poly({
          pts: [
            [cx, rowMid - r],
            [cx + r, rowMid],
            [cx, rowMid + r],
            [cx - r, rowMid]
          ],
          fill: col,
          stroke: t.critical ? T.barOutline : undefined,
          lw: 1,
          close: true
        });
        // G3: the milestone's name rides to the RIGHT of the diamond - a
        // diamond with no label tells the reader nothing.
        text({
          x: cx + r + 4,
          y: rowMid + 3,
          str: trunc(t.name || '', 9, 700, W - padR - (cx + r + 4)),
          size: 9,
          weight: 700,
          fill: T.msLabel
        });
        return;
      }
      if (t.isPhase) {
        // G6 phase summary style: a bracket bar with end ticks and the
        // rolled-up dates - visibly different from any task bar (the old
        // export drew phases in the same blue as a task).
        line({ x1: x0, y1: rowMid, x2: x0 + bw, y2: rowMid, stroke: T.bracket, lw: 2 });
        line({ x1: x0, y1: rowMid, x2: x0, y2: rowMid + 6, stroke: T.bracket, lw: 2 });
        line({ x1: x0 + bw, y1: rowMid, x2: x0 + bw, y2: rowMid + 6, stroke: T.bracket, lw: 2 });
        text({
          x: x0 + bw + 6,
          y: rowMid + 3,
          str: sp.start + ' to ' + sp.end,
          size: 9,
          weight: 600,
          fill: T.bracketDates
        });
        phaseBrackets++;
        return;
      }
      // G6 progress fill: the bar draws at reduced weight; the progress
      // portion draws solid on top, left to right.
      const by = t.critical ? 0 : 4,
        bh = rowH - (t.critical ? 0 : 8);
      rect({ x: x0, y: ry + by, w: bw, h: bh, fill: hexA(col, 0.45) });
      const pctDone = pctOf(t, sp);
      if (pctDone > 0) {
        rect({ x: x0, y: ry + by, w: Math.max(1, (bw * pctDone) / 100), h: bh, fill: col });
        progressFills++;
      }
      if (t.critical) {
        rect({ x: x0, y: ry, w: bw, h: rowH, stroke: T.barOutline, lw: 1 });
      }
    });
    // Today line (owner review: fastest way to see late vs upcoming)
    if (todayStr >= minDate && todayStr <= maxDate) {
      const tx = X(todayStr) + dayWidth / 2;
      line({
        x1: tx,
        y1: padT + headerH - 18,
        x2: tx,
        y2: H - padB,
        stroke: T.todayLine,
        lw: 1.5,
        dash: [5, 4]
      });
      text({
        x: tx + 4,
        y: padT + headerH - 20,
        str: 'TODAY',
        size: 9,
        weight: 700,
        fill: T.today
      });
    }
    // C7: legend wraps upward when one line cannot fit it all; padB = 44
    // reserves the two-row headroom so it never collides with the last row.
    const legend = [];
    if (linksHidden > 0) {
      // G5: the cap is never silent - the chart says how many links it cut.
      legend.push([T.linkArrow, '+' + linksHidden + ' hidden links']);
    }
    legend.push(
      [T.gold, 'Critical'],
      [T.task, 'Task'],
      [T.done, 'Done'],
      [T.due, 'Due soon'],
      [T.over, 'Overdue'],
      [T.weatherLine, 'Weather-exposed'],
      [T.baseline, 'Baseline'],
      [T.linkGold, 'Critical chain link'],
      [T.linkArrow, 'Dependency'],
      [T.today, 'Today line'],
      [PHASE_TABS[0], 'Phase tab'],
      [T.bracket, 'Phase summary'],
      [T.done, 'Progress (done or elapsed)'],
      [T.msLabel, 'Milestone']
    );
    let lx = padL,
      ly = H - 20;
    legend.forEach(l => {
      const lw = tw(l[1], 11, 400);
      if (lx + 24 + lw > W - padR) {
        lx = padL;
        ly -= 16;
      }
      rect({ x: lx, y: ly, w: 16, h: 12, fill: l[0] });
      text({ x: lx + 20, y: ly + 10, str: l[1], size: 11, weight: 400, fill: T.legendText });
      lx += 24 + lw + 18;
    });
    return {
      prims: prims,
      W: W,
      H: H,
      meta: {
        // GATE hooks: the QA harness reads the export's own geometry
        // without decoding pixels.
        rows: ordered.map(t => t.id),
        unassigned: unassigned.map(t => t.id),
        phaseSpans: spanOf,
        milestones: ordered
          .filter(
            t =>
              !t.isGroupHeader &&
              (!!t.milestone ||
                Number(t.duration) === 0 ||
                (t.startDate === t.endDate &&
                  /gate|sign-?off|complete|milestone|certificate/i.test(t.name || '')))
          )
          .map(t => t.id),
        dayWidth: dayWidth,
        W: W,
        H: H,
        // C5b: the logical height of the title block + table header band
        // that the PDF writer repeats on every page.
        hdrPx: padT + headerH,
        linkPolicy: linkPolicy,
        linksDrawn: linksDrawn,
        linksHidden: linksHidden,
        theme: T.name,
        columns: colDefs.map(cd => cd.key),
        prims: prims.length,
        progressFills: progressFills,
        phaseBrackets: phaseBrackets
      }
    };
  }

  // ---- G6 renderers: the SAME primitive list replays to canvas (PNG) and
  // string-builds to SVG, so the two formats can never differ.
  function ganttRenderCanvas(list, scale) {
    const canvas = document.createElement('canvas');
    canvas.width = list.W * scale;
    canvas.height = list.H * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    list.prims.forEach(p => {
      if (p.type === 'rect') {
        if (p.fill) {
          ctx.fillStyle = p.fill;
          ctx.fillRect(p.x, p.y, p.w, p.h);
        }
        if (p.stroke) {
          ctx.strokeStyle = p.stroke;
          ctx.lineWidth = p.lw || 1;
          ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
        }
      } else if (p.type === 'line') {
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.lw || 1;
        if (p.dash) {
          ctx.setLineDash(p.dash);
        }
        ctx.beginPath();
        ctx.moveTo(p.x1, p.y1);
        ctx.lineTo(p.x2, p.y2);
        ctx.stroke();
        if (p.dash) {
          ctx.setLineDash([]);
        }
      } else if (p.type === 'poly') {
        ctx.beginPath();
        p.pts.forEach((pt, i) => (i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1])));
        if (p.close) {
          ctx.closePath();
        }
        if (p.fill) {
          ctx.fillStyle = p.fill;
          ctx.fill();
        }
        if (p.stroke) {
          ctx.strokeStyle = p.stroke;
          ctx.lineWidth = p.lw || 1;
          ctx.stroke();
        }
      } else if (p.type === 'text') {
        ctx.fillStyle = p.fill;
        ctx.font = fontStrOf(p);
        ctx.textAlign = p.align === 'right' ? 'right' : 'left';
        ctx.fillText(p.str, p.x, p.y);
        ctx.textAlign = 'left';
      }
    });
    return canvas;
    function fontStrOf(p) {
      return (p.weight || 400) + ' ' + p.size + 'px sans-serif';
    }
  }

  function ganttRenderSVG(list) {
    const esc = str =>
      String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    const num = n => (Math.round(n * 100) / 100).toString();
    let out =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      list.W +
      '" height="' +
      list.H +
      '" viewBox="0 0 ' +
      list.W +
      ' ' +
      list.H +
      '">';
    list.prims.forEach(p => {
      if (p.type === 'rect') {
        out +=
          '<rect x="' +
          num(p.x) +
          '" y="' +
          num(p.y) +
          '" width="' +
          num(p.w) +
          '" height="' +
          num(p.h) +
          '" fill="' +
          esc(p.fill || 'none') +
          '"' +
          (p.stroke
            ? ' stroke="' + esc(p.stroke) + '" stroke-width="' + num(p.lw || 1) + '"'
            : '') +
          '/>';
      } else if (p.type === 'line') {
        out +=
          '<line x1="' +
          num(p.x1) +
          '" y1="' +
          num(p.y1) +
          '" x2="' +
          num(p.x2) +
          '" y2="' +
          num(p.y2) +
          '" stroke="' +
          esc(p.stroke) +
          '" stroke-width="' +
          num(p.lw || 1) +
          '"' +
          (p.dash ? ' stroke-dasharray="' + p.dash.join(',') + '"' : '') +
          '/>';
      } else if (p.type === 'poly') {
        out +=
          '<polygon points="' +
          p.pts.map(pt => num(pt[0]) + ',' + num(pt[1])).join(' ') +
          '" fill="' +
          esc(p.fill || 'none') +
          '"' +
          (p.stroke
            ? ' stroke="' + esc(p.stroke) + '" stroke-width="' + num(p.lw || 1) + '"'
            : '') +
          '/>';
      } else if (p.type === 'text') {
        out +=
          '<text x="' +
          num(p.x) +
          '" y="' +
          num(p.y) +
          '" font-family="sans-serif" font-size="' +
          num(p.size) +
          '" font-weight="' +
          (p.weight || 400) +
          '" fill="' +
          esc(p.fill) +
          '"' +
          (p.align === 'right' ? ' text-anchor="end"' : '') +
          '>' +
          esc(p.str) +
          '</text>';
      }
    });
    return out + '</svg>';
  }

  function ganttDownload(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 400);
  }

  function ganttExportBase(s) {
    return (
      (s.projectName || 'project').replace(/[^a-z0-9]+/gi, '-').toLowerCase() +
      '-gantt-' +
      new Date().toISOString().slice(0, 10)
    );
  }

  function exportGanttPNG() {
    const s = ns.State.getState();
    const o = ganttExportOpts();
    const list = buildGanttDrawList(o);
    if (!list) {
      showToast('No dated tasks to export.', 'err');
      return;
    }
    // G7 canvas-limit guard: past the common 16,384px side / ~268MP area
    // limits toBlob returns null (or a blank image) and the user sees
    // "Export failed." - clamp the device-pixel scale so EVERY export
    // decodes. Below 0.75 the image is small but real; the toast says so.
    const MAX_SIDE = 16000,
      MAX_AREA = 2.6e8;
    let scale = Math.min(
      2,
      MAX_SIDE / list.W,
      MAX_SIDE / list.H,
      Math.sqrt(MAX_AREA / (list.W * list.H))
    );
    let scaledNote = '';
    if (scale < 0.75) {
      scale = Math.max(scale, 0.3); // extreme row counts: small but decodable
      scaledNote = ' (scaled to fit browser image limits)';
    }
    const canvas = ganttRenderCanvas(list, scale);
    window.__ganttExportMeta = Object.assign({}, list.meta, {
      format: 'png',
      scale: scale,
      canvasW: canvas.width,
      canvasH: canvas.height
    });
    canvas.toBlob(function (blob) {
      if (!blob) {
        showToast('Export failed.', 'err');
        return;
      }
      ganttDownload(blob, ganttExportBase(s) + '.png');
      showToast('High-res Gantt exported (PNG)' + scaledNote + '.', 'ok');
    }, 'image/png');
  }

  // G6 format: SVG is vector and string-built from the SAME draw list as
  // the PNG, so it scales to any projector or plotter and can never
  // disagree with the raster output.
  function exportGanttSVG() {
    const s = ns.State.getState();
    const o = ganttExportOpts();
    const list = buildGanttDrawList(o);
    if (!list) {
      showToast('No dated tasks to export.', 'err');
      return;
    }
    const svg = ganttRenderSVG(list);
    window.__ganttExportSVG = svg;
    window.__ganttExportMeta = Object.assign({}, list.meta, {
      format: 'svg',
      svgTexts: (svg.match(/<text/g) || []).length
    });
    ganttDownload(
      new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      ganttExportBase(s) + '.svg'
    );
    showToast('Gantt exported (SVG vector).', 'ok');
  }

  // C5b (directive): true PDF from the SAME draw list via the shared
  // writer in js/mmgr-pdf.js - vector, landscape, searchable text.
  // 'fit' is one page sized to the content; A4/A3 paginate vertically
  // with the header band + table column headers repeated per page.
  function exportGanttPDF() {
    const s = ns.State.getState();
    const o = ganttExportOpts();
    const list = buildGanttDrawList(o);
    if (!list) {
      showToast('No dated tasks to export.', 'err');
      return;
    }
    if (!ns.Pdf || typeof ns.Pdf.build !== 'function') {
      showToast('PDF export is unavailable.', 'err');
      return;
    }
    const res = ns.Pdf.build(list.prims, {
      page: o.page,
      W: list.W,
      H: list.H,
      hdrPx: list.meta.hdrPx
    });
    window.__ganttExportMeta = Object.assign({}, list.meta, {
      format: 'pdf',
      page: res.mode,
      pdfPages: res.pages,
      pdfBytes: res.bytes.length
    });
    window.__ganttExportPDF = res;
    ganttDownload(new Blob([res.bytes], { type: 'application/pdf' }), ganttExportBase(s) + '.pdf');
    showToast(
      'Gantt exported (PDF' + (res.pages > 1 ? ', ' + res.pages + ' pages' : '') + ').',
      'ok'
    );
  }

  // ---- G8 export dialog: format, theme, columns, links, baseline. The
  // last choice is remembered per project in ui state (never in project
  // data), and the zero-click default - PNG, light, all columns, near
  // links, baseline on - already produces a good print-ready export.
  function ganttExportDialogSet(id, val) {
    const el = document.querySelector('input[name="' + id + '"][value="' + val + '"]');
    if (el) {
      el.checked = true;
    }
  }
  function openGanttExport() {
    const o = ganttExportOpts();
    ganttExportDialogSet('gx-format', o.format);
    ganttExportDialogSet('gx-page', o.page);
    ganttExportDialogSet('gx-theme', o.theme);
    ganttExportDialogSet('gx-links', o.links);
    ['wbs', 'dur', 'start', 'finish', 'pct', 'assignee'].forEach(k => {
      const el = document.getElementById('gx-c-' + k);
      if (el) {
        el.checked = !!o.columns[k];
      }
    });
    const bl = document.getElementById('gx-baseline');
    if (bl) {
      bl.checked = !!o.baseline;
    }
    const m = document.getElementById('gantt-export-modal');
    if (m) {
      m.classList.add('on');
    }
  }
  function closeGanttExport() {
    const m = document.getElementById('gantt-export-modal');
    if (m) {
      m.classList.remove('on');
    }
  }
  function ganttExportRun() {
    const val = name => {
      const el = document.querySelector('input[name="' + name + '"]:checked');
      return el ? el.value : '';
    };
    const cols = {};
    ['wbs', 'dur', 'start', 'finish', 'pct', 'assignee'].forEach(k => {
      const el = document.getElementById('gx-c-' + k);
      cols[k] = el ? !!el.checked : true;
    });
    const bl = document.getElementById('gx-baseline');
    const s = ns.State.getState();
    s.ui = s.ui || {};
    s.ui.ganttExport = {
      format: val('gx-format') === 'svg' ? 'svg' : val('gx-format') === 'pdf' ? 'pdf' : 'png',
      page: val('gx-page') === 'a4' || val('gx-page') === 'a3' ? val('gx-page') : 'fit',
      theme: val('gx-theme') === 'dark' ? 'dark' : 'light',
      columns: cols,
      baseline: bl ? !!bl.checked : true
    };
    // G5's key stays the policy source; the dialog's Links row writes it.
    s.ui.ganttLinkPolicy = val('gx-links') === 'all' ? 'all' : 'near';
    ns.State.save(true);
    closeGanttExport();
    if (s.ui.ganttExport.format === 'svg') {
      exportGanttSVG();
    } else if (s.ui.ganttExport.format === 'pdf') {
      exportGanttPDF();
    } else {
      exportGanttPNG();
    }
  }
  // ---- Weather actions ---- (extracted to js/app/weather.js)
  async function wxGeocode() {
    if (ns.AppWeather) {
      ns.AppWeather.wxGeocode();
    }
  }
  async function wxRefresh() {
    if (ns.AppWeather) {
      ns.AppWeather.wxRefresh();
    }
  }
  async function wxUseLocation() {
    if (ns.AppWeather) {
      ns.AppWeather.wxUseLocation();
    }
  }
  function wxLogToday() {
    if (ns.AppWeather) {
      ns.AppWeather.wxLogToday();
    }
  }
  function wxLogManual() {
    if (ns.AppWeather) {
      ns.AppWeather.wxLogManual();
    }
  }
  function wxCopyNotice() {
    if (ns.AppWeather) {
      ns.AppWeather.wxCopyNotice();
    }
  }
  function wxSetView(el) {
    if (ns.AppWeather) {
      ns.AppWeather.wxSetView(el);
    }
  }
  function wxDelLogEntry(el) {
    if (ns.AppWeather) {
      ns.AppWeather.wxDelLogEntry(el);
    }
  }

  // ---- Hold / Clear / Undo / Redo ---- (extracted to js/app/history.js)
  function startHold(section) {
    if (ns.AppHistory) {
      ns.AppHistory.startHold(section);
    }
  }
  function cancelHold() {
    if (ns.AppHistory) {
      ns.AppHistory.cancelHold();
    }
  }
  function clearSection(section) {
    if (ns.AppHistory) {
      ns.AppHistory.clearSection(section);
    }
  }
  function undoClr() {
    if (ns.AppHistory) {
      ns.AppHistory.undoClr();
    }
  }
  function undo() {
    if (ns.AppHistory) {
      ns.AppHistory.undo();
    }
  }
  function redo() {
    if (ns.AppHistory) {
      ns.AppHistory.redo();
    }
  }
  function updateUndoUi() {
    if (ns.AppHistory) {
      ns.AppHistory.updateUndoUi();
    }
  }

  // ---- Weather Region ---- (extracted to js/app/weather.js)
  function setRegion(val) {
    if (ns.AppWeather && ns.AppWeather.setRegion) {
      ns.AppWeather.setRegion(val);
    }
  }

  // ---- Project Deadline (owner 2026-09-27) ----
  // Engine-side commitment date: the backward pass gives terminal chains
  // float when the plan finishes before it (a missed deadline is clamped,
  // never negative-float fiction). Sibling of weatherRegion's setter; the
  // gantt toolbar date input carries data-action="setDeadline" and arrives
  // through the same change-event delegation. Empty value clears the
  // constraint. A cascade after the change re-stamps float/criticals; dates
  // are NEVER rewritten by the deadline itself.
  function setDeadline(val) {
    ns.State.updateState(function (s) {
      s.projectDeadline = (val || '').trim();
    });
    const dl = (val || '').trim();
    if (ns.Schedule && ns.Schedule.annotateSchedule && ns.State.getState().tasks.length) {
      // B8 companion fix (audit 2026-09-28): this recompute silently no-oped
      // since v323 - computePlan is not exported on ns.Schedule, so the call
      // threw ReferenceError and the catch swallowed it.
      // B13/B14 (audit 2026-09-28): the replacement inline sequence ran
      // backwardPass without the deadline on a both-dates-only subset, so
      // the float/criticals it stamped DISAGREED with the cascade engine
      // (terminal-chain float collapsed). annotateSchedule is the
      // cascade-identical sequence, read-only: dates never move.
      ns.Schedule.annotateSchedule();
    }
    if (ns.Render) {
      ns.Render.renderGantt();
      if (ns.Render.renderDash) {
        ns.Render.renderDash();
      }
    }
    if (ns.App && ns.App.showToast) {
      ns.App.showToast(
        dl ? 'Deadline set: ' + dl + ' - cascade to refresh float.' : 'Deadline cleared.',
        'ok'
      );
    }
  }

  // ---- Confirmation Dialog (replaces bare confirm() for destructive ops) ----
  // ---- Confirmation Dialog ---- (extracted to js/app/confirm.js)
  function askConfirm(opts) {
    if (ns.AppConfirm) {
      ns.AppConfirm.askConfirm(opts);
    }
  }
  function cfmOk() {
    if (ns.AppConfirm) {
      ns.AppConfirm.cfmOk();
    }
  }
  function cfmCancel() {
    if (ns.AppConfirm) {
      ns.AppConfirm.cfmCancel();
    }
  }

  // ---- Multi-tab Conflict Resolution ----
  let _pendingExternal = null;
  function onExternalChange(parsed) {
    const s = S();
    if (!parsed || !s || !parsed.updatedAt) {
      return;
    }
    if (parsed.updatedAt <= s.updatedAt) {
      return;
    } // not newer , ignore
    if (JSON.stringify(parsed) === JSON.stringify(s)) {
      return;
    } // same content
    _pendingExternal = parsed;
    const modal = U.$('conflict-modal');
    if (modal) {
      const info = U.$('conflict-info');
      if (info) {
        info.textContent =
          'Another tab saved a newer version of this project (' +
          new Date(parsed.updatedAt).toLocaleString() +
          '). Keep your current edits, or load their version.';
      }
      modal.classList.add('on');
    }
  }

  function keepMine() {
    const modal = U.$('conflict-modal');
    if (modal) {
      modal.classList.remove('on');
    }
    _pendingExternal = null;
    ns.State.save(true); // re-persist ours with a fresh updatedAt
    showToast('Kept your version.', 'ok');
  }

  function keepTheirs() {
    const modal = U.$('conflict-modal');
    if (modal) {
      modal.classList.remove('on');
    }
    const incoming = _pendingExternal;
    _pendingExternal = null;
    if (incoming && ns.State.adoptExternal(incoming)) {
      R.renderAll();
      if (ns.Charter) {
        ns.Charter.loadCharterData();
      }
      if (ns.Sprint) {
        ns.Sprint.loadSprintData();
      }
      showToast("Loaded the other tab's version.", 'ok');
    }
  }

  // Close every custom modal we own (Escape key path).
  // (extracted to js/app/confirm.js)
  function closeModals() {
    if (ns.AppConfirm) {
      ns.AppConfirm.closeModals();
    }
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
      message:
        'This copies the baseline start/end dates, durations and statuses back onto the current task list.',
      danger: true,
      confirmLabel: 'Restore Baseline',
      onOk: function () {
        ns.State.pushUndo();
        ns.State.updateState(function (state) {
          const baseMap = {};
          (state.baseline.tasks || []).forEach(bt => {
            baseMap[bt.id] = bt;
          });
          (state.tasks || []).forEach(t => {
            const bt = baseMap[t.id];
            if (bt) {
              t.startDate = bt.startDate;
              t.endDate = bt.endDate;
              t.duration = bt.duration;
              if (bt.status) {
                t.status = bt.status;
              }
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
    ns.State.updateState(function (st) {
      st.hlCritical = !st.hlCritical;
    });
    R.renderGantt();
    R.renderWbs();
    if (btn) {
      btn.classList.toggle('is-on', !!S().hlCritical);
    }
  }

  function tglLeadtimeLane(btn) {
    // Monolith kb-leadtime-tgl: dedicated Kanban swimlane for Lead-Time /
    // third-party tasks. Persisted so re-renders keep the lane state.
    ns.State.updateState(function (st) {
      st.kbShowLeadtime = !st.kbShowLeadtime;
    });
    R.renderKanban();
    if (btn) {
      btn.classList.toggle('is-on', !!S().kbShowLeadtime);
    }
  }

  // ---- Kanban ----
  let dragTaskId = null;

  // OWNER 2026-09-28: dragend fires on the drag SOURCE element. A successful
  // drop re-renders the board, which detaches that element, so the event
  // never bubbles to document and the dragend cleanup would never run -
  // the board's is-dragging highlight would stick on. Drop paths call this
  // explicitly; dragend still covers cancelled/failed drags (source stays
  // attached there, so its dragend does reach document).
  function endBoardDrag() {
    const board = document.querySelector('.kb');
    if (board) {
      board.classList.remove('is-dragging');
    }
  }

  function dragCard(ev, taskId) {
    // VIEW-ONLY HARDENING (owner 2026-09-12): a read-only session must never
    // move a card. The DnD listeners below are plain document-level events,
    // NOT the data-action delegation, so guardReadonly() never sees them.
    // Stop the drag at the source instead of letting dropCard silently no-op.
    if (isReadonly()) {
      if (ev && ev.dataTransfer) {
        try {
          ev.dataTransfer.effectAllowed = 'none';
        } catch (e) {}
      }
      if (ev && ev.preventDefault) {
        ev.preventDefault();
      }
      showToast('View-only access: the board can be read but not changed.', 'err');
      dragTaskId = null;
      return;
    }
    dragTaskId = taskId;
    ev.dataTransfer.effectAllowed = 'move';
  }

  function dropCard(ev, status) {
    ev.preventDefault();
    // Second guard (defense in depth): the drop is the state mutation.
    if (isReadonly()) {
      showToast('View-only access: the board can be read but not changed.', 'err');
      dragTaskId = null;
      document.querySelectorAll('.kcol').forEach(c => c.classList.remove('dov'));
      return;
    }
    if (dragTaskId) {
      const task = (S().tasks || []).find(t => t.id === dragTaskId);
      // Monolith drop guard: lead-time cards belong in the Lead-Time lane ,
      // WIP columns are for crew-driven work. Refuse the drop with a toast
      // instead of silently moving a third-party wait into a work column.
      if (task && task.leadTime) {
        showToast(
          'Lead-time cards belong in the Lead-Time lane , WIP columns are for crew-driven work.',
          'err'
        );
        dragTaskId = null;
        document.querySelectorAll('.kcol').forEach(c => c.classList.remove('dov'));
        return;
      }
      ns.State.updateState(function (s) {
        const task = (s.tasks || []).find(t => t.id === dragTaskId);
        if (task) {
          task.status = status;
        }
        // OWNER 2026-09-28: a card that enters a status column LEAVES the
        // Lead-Time lane. The old render kept it in both places, so dragging
        // it out changed nothing and dropping it back toggled leadTime off -
        // the card silently vanished from the lane.
        if (task) {
          task.leadTime = false;
        }
      });
      R.renderKanban();
      R.renderWbs();
      R.renderDash();
    }
    dragTaskId = null;
    endBoardDrag();
    document.querySelectorAll('.kcol').forEach(c => c.classList.remove('dov'));
  }

  function dropCardLeadtime(ev) {
    ev.preventDefault();
    // VIEW-ONLY HARDENING: same guard as dropCard.
    if (isReadonly()) {
      showToast('View-only access: the board can be read but not changed.', 'err');
      dragTaskId = null;
      document.querySelectorAll('.kcol').forEach(c => c.classList.remove('dov'));
      return;
    }
    if (dragTaskId) {
      ns.State.updateState(function (s) {
        const task = (s.tasks || []).find(t => t.id === dragTaskId);
        // OWNER 2026-09-28: idempotent add, no toggle. Toggling made the
        // out-and-back dance silently REMOVE the lead-time flag (the
        // vanishing card); a lane drop now always means "keep it lead-time".
        if (task) {
          task.leadTime = true;
        }
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
    endBoardDrag();
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
    const starts = unstarted
      .map(t => t.startDate)
      .filter(Boolean)
      .sort();
    const ends = unstarted
      .map(t => t.endDate)
      .filter(Boolean)
      .sort();
    ns.State.updateState(function (state) {
      if (!state.sprint) {
        state.sprint = { name: 'Sprint 1', start: '', end: '' };
      }
      state.sprint.start = starts.length ? starts[0] : '';
      state.sprint.end = ends.length ? ends[ends.length - 1] : '';
    });
    // Refresh the sprint panel inputs
    if (ns.Tasks && ns.Tasks.loadSprintData) {
      ns.Tasks.loadSprintData();
    }
    showToast('Sprint populated with ' + unstarted.length + ' unstarted task(s).', 'ok');
  }

  // ---- Prompts ----
  function openPrompt(type) {
    const prompt = ns.Prompts.generate(type);
    const txt = U.$('om-txt');
    const modal = U.$('om');
    if (txt && modal) {
      txt.value = prompt;
      U.$('om-title').innerHTML =
        '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-edit"></use></svg> Prompt , ' +
        type; // ok: type is a fixed prompt-type label from the prompts table
      modal.classList.add('open');
    }
    // Monolith port: the Daily Field report gets a "Snapshot Now" button in
    // the modal header. Clicking it saves today's task statuses so tomorrow's
    // prompt shows a real completed-since-last-snapshot diff.
    const existing = document.getElementById('snap-daily-btn');
    if (existing) {
      existing.remove();
    }
    if (type === 'daily') {
      const title = U.$('om-title');
      if (title) {
        setTimeout(() => {
          if (document.getElementById('snap-daily-btn')) {
            return;
          }
          const b = document.createElement('button');
          b.id = 'snap-daily-btn';
          b.className = 'btn btn-g btn-s';
          b.style.marginLeft = '10px';
          b.textContent = 'Snapshot Now';
          b.title =
            "Save current task statuses. Tomorrow's report will show what changed since this snapshot.";
          b.addEventListener('click', function () {
            if (ns.FieldReport && ns.FieldReport.snapshotDaily) {
              ns.FieldReport.snapshotDaily();
            }
          });
          title.parentNode.appendChild(b);
          // Task 5 (2026-09-19): one-voice capture from the field report +
          // quick action item. The transcript lands in today's field notes
          // (inside the report prompt) - never in a meeting record.
          if (ns.Voice && ns.Voice.startForFieldReport) {
            const v = document.createElement('button');
            v.id = 'field-voice-btn';
            v.className = 'btn btn-o btn-s';
            v.style.marginLeft = '10px';
            v.textContent = 'Capture audio';
            v.title =
              'One-voice capture: records one microphone. It cannot tell people apart - keep attendee names in the meeting header instead. The transcript lands in this report, hand-editable.';
            v.addEventListener('click', function () {
              if (v.textContent === 'Capture audio') {
                if (ns.Voice.startForFieldReport()) {
                  v.textContent = 'Stop capture';
                }
              } else {
                ns.Voice.stopCapture();
                v.textContent = 'Capture audio';
              }
            });
            title.parentNode.appendChild(v);
          }
          const a = document.createElement('button');
          a.id = 'field-action-btn';
          a.className = 'btn btn-o btn-s';
          a.style.marginLeft = '10px';
          a.textContent = 'Add action item';
          a.title =
            'Adds an action to the Closure list, referenced to this report. It counts in the Decision Engine until done.';
          a.addEventListener('click', function () {
            if (ns.FieldReport && ns.FieldReport.addFieldAction) {
              ns.FieldReport.addFieldAction();
            }
          });
          title.parentNode.appendChild(a);
        }, 30);
      }
    }
  }

  // Monolith-side mechanics: open the drawer on the Controls tab. The body
  // lives in js/app/backup.js (delegate-gate contract) which adds the cloud
  // sign-in affordance on top; monolith openDrwToSave is a one-line delegate.
  function openDrwToSaveMechanics() {
    swDtab('ctrl', null);
    openDrw();
  }
  function openDrwToSave() {
    if (ns.AppBackup) {
      ns.AppBackup.openDrwToSave();
    }
  }

  // ---- Backup & Cloud-Sync UI ---- (extracted to js/app/backup.js)
  function cloudLinked() {
    return ns.AppBackup && ns.AppBackup.cloudLinked ? ns.AppBackup.cloudLinked() : false;
  }
  function scheduleCloudAutoSave() {
    if (ns.AppBackup) {
      ns.AppBackup.scheduleCloudAutoSave();
    }
  }
  function flushCloudAutoSave() {
    if (ns.AppBackup) {
      ns.AppBackup.flushCloudAutoSave();
    }
  }
  function bkToggle() {
    if (ns.AppBackup) {
      ns.AppBackup.bkToggle();
    }
  }
  function bkClose() {
    if (ns.AppBackup) {
      ns.AppBackup.bkClose();
    }
  }
  function bkSyncHint() {
    if (ns.AppBackup) {
      ns.AppBackup.bkSyncHint();
    }
  }
  function bkCloud() {
    if (ns.AppBackup) {
      ns.AppBackup.bkCloud();
    }
  }

  function openDrwToPrompts(type) {
    swDtab('prompt', null);
    openDrw();
  }

  function jumpToDashTimeline() {
    showSec('dash', document.querySelector('.sec-btn'));
  }

  // ---- Export & File I/O ---- (extracted to js/app/export.js)
  function openOM() {
    if (ns.AppExport) {
      ns.AppExport.openOM();
    }
  }
  function closeOM() {
    if (ns.AppExport) {
      ns.AppExport.closeOM();
    }
  }
  function cpOut() {
    if (ns.AppExport) {
      ns.AppExport.cpOut();
    }
  }
  function loadClip() {
    if (ns.AppExport) {
      ns.AppExport.loadClip();
    }
  }
  function saveProjectFile() {
    if (ns.AppExport) {
      ns.AppExport.saveProjectFile();
    }
  }
  function loadProjectFile(ev) {
    if (ns.AppExport) {
      ns.AppExport.loadProjectFile(ev);
    }
  }

  // Rank 4.4: field-level merge of an exported project file into the current
  // plan. Every tracked field keeps whichever side is newer (per-field
  // timestamps, falling back to updatedAt); ties keep the LOCAL value, so a
  // merge never silently discards local edits. Reports a per-field summary.
  function mergeProjectFile(ev) {
    const file = ev.target.files[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = function (e) {
      let parsed = null;
      try {
        parsed = JSON.parse(e.target.result);
      } catch (err) {
        showToast('Invalid project file.', 'err');
        return;
      }
      const out = ns.State.mergeExternal(parsed);
      if (!out) {
        showToast('Invalid project file.', 'err');
        return;
      }
      R.renderAll();
      if (ns.Charter) {
        ns.Charter.loadCharterData();
      }
      if (ns.Sprint) {
        ns.Sprint.loadSprintData();
      }
      // Surface every two-way conflict by NAME , never silently resolved.
      // A conflict is a field present on BOTH sides; the newer stamp wins
      // and the loser is named in the toast so the user can verify it.
      const conflicts = out.report.filter(
        r => r.reason === 'newer-timestamp' || r.reason === 'local-equal-or-newer'
      );
      // Cap the named list , a full project import can conflict on dozens of
      // fields and would overflow the toast.
      const NAMED = 5;
      const names = conflicts
        .slice(0, NAMED)
        .map(r => r.field)
        .join(', ');
      const more = conflicts.length > NAMED ? ', +' + (conflicts.length - NAMED) + ' more' : '';
      const fromFile = out.report.filter(r => r.side === 'incoming').length;
      const keptLocal = out.report.length - fromFile;
      const summary = names
        ? 'Merged ' +
          fromFile +
          ' field(s) from file, kept ' +
          keptLocal +
          ' local. Conflicting fields (newest edit won): ' +
          names +
          more +
          '.'
        : 'Merged ' +
          fromFile +
          ' field(s) from file, kept ' +
          keptLocal +
          ' local. No field had edits on both sides.';
      // Rank 4.5: after a merge (multi-device use detected), offer the
      // single dismissible optional-identity suggestion , if not signed in
      // and not already dismissed on this device. Never a modal, never spam.
      if (ns.Sync && ns.Sync.noteMultiDeviceUse) {
        ns.Sync.noteMultiDeviceUse();
      }
      showToast(summary, out.adopted > 0 ? 'ok' : 'warn');
    };
    reader.readAsText(file);
    ev.target.value = '';
  }

  function saveBaseline() {
    if (ns.AppExport) {
      ns.AppExport.saveBaseline();
    }
  }

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
    'Utils',
    'State',
    'Render',
    'Prompts',
    'Weather',
    'FieldReport',
    'Schedule',
    'Tasks',
    'Sprint',
    'WbsImport',
    'ImportDates',
    'Risks',
    'Resources',
    'Budget',
    'Spend',
    'Stakeholders',
    'Changes',
    'Log',
    'Closure',
    'Comms',
    'Documents',
    'Raci',
    'Charter',
    'Health',
    'Evm',
    'Dmaic',
    'Meetings',
    'Voice',
    'Defs',
    'Decisions',
    'Forecast',
    'Claim',
    'Digest'
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
          const msg =
            'My MaNaGeR boot ABORTED , missing modules: ' +
            missing.join(', ') +
            '. Check the <script> load order in project.html.';
          console.error(msg);
          // Fail visibly for end users too , a silent blank page tells them
          // nothing about why nothing rendered.
          const sp = document.getElementById('boot-splash');
          if (sp) {
            sp.classList.add('off');
          }
          const el = document.createElement('div');
          el.style.cssText =
            'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#1a1a1a;color:#ff6b6b;font:14px/1.5 monospace;padding:40px;text-align:center;z-index:99999';
          el.textContent =
            'App failed to start , missing modules: ' +
            missing.join(', ') +
            '. Check the <script> load order.';
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

  // ---- M-2 (audit 2026-10-18, 8.5): Your data - export + account delete ----
  // EXPORT is fully client-side: offline-first means the device IS the source,
  // so we walk every mmgr_* key in localStorage and hand back one JSON file.
  // The BYO AI key is deliberately NOT here - it lives in sessionStorage and
  // never touches localStorage (Q&A "Where does my AI key live?").
  function exportMyData() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf('mmgr_') !== 0) {
        continue;
      }
      const raw = localStorage.getItem(k);
      try {
        data[k] = JSON.parse(raw);
      } catch (e) {
        data[k] = raw; // a plain-string slot (rare) still exports verbatim
      }
    }
    const payload = {
      app: 'My MaNaGeR',
      exportedAt: new Date().toISOString(),
      note: 'Everything this browser holds for you. Keys starting mmgr_state_ are full projects.',
      count: Object.keys(data).length,
      data: data
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'my-manager-data-' + String(payload.exportedAt).slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 400);
    showToast(
      payload.count
        ? 'Downloaded ' + payload.count + ' settings as one JSON file.'
        : 'Nothing to download yet.',
      payload.count ? 'ok' : 'warn'
    );
    return payload;
  }

  // The delete block renders ONLY when signed in, and mirrors the Worker's
  // contract exactly (src/auth/session.js handleAuthDeleteAccount): an email
  // account confirms with its password, a Google account types DELETE.
  async function renderDataAccount() {
    const host = U.$('data-account');
    if (!host) {
      return;
    }
    let user = null;
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      const d = res.ok ? await res.json() : null;
      if (d && d.ok && d.user) {
        user = d.user;
      }
    } catch (e) {
      /* static host / offline: no delete UI, which is correct */
    }
    if (!user) {
      host.innerHTML = '';
      return;
    }
    const isEmail = String(user.sub || '').indexOf('email:') === 0;
    host.innerHTML =
      '<div class="ctl-sec"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-trash"></use></svg> Delete account</div>' +
      '<div class="sr-hint ctl-lead">This removes your account and everything synced to it from our servers. ' +
      'Download your data first if you want a copy. This cannot be undone.</div>' +
      (isEmail
        ? '<div class="sr"><span class="sl"><label for="del-acct-secret">Confirm with your password</label></span>' +
          '<input class="ctl-in w150" type="password" id="del-acct-secret" autocomplete="current-password" aria-label="Your password, to confirm deleting your account"></div>'
        : '<div class="sr"><span class="sl"><label for="del-acct-secret">Type DELETE to confirm</label></span>' +
          '<input class="ctl-in w150" type="text" id="del-acct-secret" autocomplete="off" spellcheck="false" aria-label="Type DELETE to confirm deleting your account"></div>') +
      '<div class="ctl-actions"><button class="btn btn-d btn-s" data-action="deleteAccount" data-kind="' +
      (isEmail ? 'password' : 'delete') +
      '"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-trash"></use></svg> Delete my account</button></div>';
  }

  async function deleteAccount(btn) {
    const kind = (btn && btn.getAttribute('data-kind')) || 'delete';
    const field = U.$('del-acct-secret');
    const val = field ? String(field.value || '') : '';
    if (kind === 'password' && !val) {
      showToast('Enter your password to confirm.', 'warn');
      return;
    }
    if (kind !== 'password' && val !== 'DELETE') {
      showToast('Type DELETE to confirm.', 'warn');
      return;
    }
    if (
      !window.confirm(
        'Delete your account and everything synced to it? This cannot be undone. Download your data first if you want a copy.'
      )
    ) {
      return;
    }
    const body = kind === 'password' ? { password: val } : { confirm: 'DELETE' };
    let res = null;
    let out = null;
    try {
      res = await fetch('/api/auth/delete-account', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      out = await res.json();
    } catch (e) {
      showToast('Could not reach the server. Check your connection and try again.', 'err');
      return;
    }
    if (res.ok && out && out.ok) {
      showToast('Your account and its server data are deleted.', 'ok');
      // Server cleared the session cookie; clear the local chip + go home.
      document.dispatchEvent(new CustomEvent('mmgr:google-signed-out'));
      setTimeout(function () {
        window.location.href = 'index.html';
      }, 900);
    } else {
      showToast((out && out.error) || 'Could not delete your account. Try again.', 'err');
    }
  }

  // M-2: keep the delete block in step with the session. It renders only when
  // signed in (renderDataAccount clears the host otherwise), so re-run it on
  // every sign-in/out and whenever the Controls tab is opened.
  document.addEventListener('mmgr:google-signed-in', function () {
    renderDataAccount();
  });
  document.addEventListener('mmgr:google-signed-out', function () {
    renderDataAccount();
  });
  document.addEventListener('mmgr:user-changed', function () {
    renderDataAccount();
  });

  // ---- API ----
  ns.App = {
    exportMyData: exportMyData,
    renderDataAccount: renderDataAccount,
    deleteAccount: deleteAccount,
    init: init,
    _boot: _boot,
    openDrwToSaveMechanics: openDrwToSaveMechanics,
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
    tglSidebarOpen: function () {
      setSidebarOpen(!document.body.classList.contains('sidebar-open'));
    },
    syncConnect: syncConnect,
    syncSignOut: syncSignOut,
    syncClientId: syncClientId,
    syncDismissSuggest: syncDismissSuggest,
    openSignInModal: openSignInModal,
    closeSignInModal: closeSignInModal,
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
    exportGanttSVG: exportGanttSVG,
    exportGanttPDF: exportGanttPDF,
    openGanttExport: openGanttExport,
    closeGanttExport: closeGanttExport,
    ganttExportRun: ganttExportRun,
    startHold: startHold,
    cancelHold: cancelHold,
    clearSection: clearSection,
    undoClr: undoClr,
    undo: undo,
    redo: redo,
    updateUndoUi: updateUndoUi,
    setRegion: setRegion,
    setDeadline: setDeadline,
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
    endBoardDrag: endBoardDrag,
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
(function () {
  const ACTION_MAP = {
    // App controller
    showSec: el => {
      const section = el.getAttribute('data-section');
      window.MMGR.App.showSec(section, el);
    },
    swMeth: el => {
      const meth = el.getAttribute('data-meth');
      window.MMGR.App.swMeth(meth, el);
    },
    swDtab: el => {
      window.MMGR.App.swDtab(el.getAttribute('data-tab'), el);
    },
    addTask: () => window.MMGR.Tasks.addTask(),
    delTask: el => window.MMGR.Tasks.delTask(el.getAttribute('data-id')),
    indentTask: el => window.MMGR.Tasks.indentTask(el.getAttribute('data-id')),
    addTaskComment: el => {
      const taskId = el.getAttribute('data-id');
      const input = document.getElementById('comment-input-' + taskId);
      if (input && input.value.trim()) {
        window.MMGR.Tasks.addTaskComment(taskId, input.value.trim());
        input.value = '';
      }
    },
    delTaskComment: el =>
      window.MMGR.Tasks.delTaskComment(
        el.getAttribute('data-task-id'),
        el.getAttribute('data-comment-id')
      ),
    setTaskFollowUp: el => {
      const taskId = el.getAttribute('data-id');
      const assignee = prompt('Follow-up assignee:');
      const dueDate = prompt('Due date (YYYY-MM-DD):');
      if (assignee) {
        window.MMGR.Tasks.setTaskFollowUp(taskId, assignee, dueDate);
      }
    },
    completeTaskFollowUp: el => window.MMGR.Tasks.completeTaskFollowUp(el.getAttribute('data-id')),
    clearTaskFollowUp: el => window.MMGR.Tasks.clearTaskFollowUp(el.getAttribute('data-id')),
    // B11 (audit 2026-09-28): this delegation IIFE has NO closure over the
    // App module's internals (see guardReadonly's note below) - bare ns/S/U/R/
    // showToast here threw ReferenceError and the feature died on click.
    // Every helper routes through the published window.MMGR.* API like the
    // neighboring handlers.
    toggleTaskComments: el => {
      if (window.MMGR.Render && window.MMGR.Render.toggleTaskComments) {
        window.MMGR.Render.toggleTaskComments(el.getAttribute('data-id'));
      }
    },
    importCrossProjectResources: () => {
      // Build a modal listing localStorage projects with their resources
      // (B11 2026-09-28: ns/S/U/showToast -> window.MMGR.* - see note above).
      const currentId = window.MMGR.projectId || '';
      const projects = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('mmgr_state_')) {
            const pid = k.replace('mmgr_state_', '');
            if (pid === currentId) {
              continue;
            }
            try {
              const st = JSON.parse(localStorage.getItem(k));
              const res = st && st.resources && st.resources.length ? st.resources : [];
              if (res.length) {
                projects.push({
                  id: pid,
                  name: st.charter && st.charter.projectName ? st.charter.projectName : pid,
                  resources: res
                });
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
      if (!projects.length) {
        window.MMGR.App.showToast('No other projects with resources found on this device.', 'warn');
        return;
      }
      // Show modal
      let html =
        '<div class="card m0a" style="padding:16px;max-width:500px"><div style="font-weight:600;font-size:.85rem;margin-bottom:10px">Import Resources from Another Project</div>';
      projects.forEach(function (p) {
        const curRes = (window.MMGR.State.getState().resources || []).map(r =>
          r.name.toLowerCase()
        );
        const newRes = p.resources.filter(
          r => r.name && curRes.indexOf(r.name.toLowerCase()) === -1
        );
        html +=
          '<div style="border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:8px">';
        html +=
          '<div style="font-weight:600;font-size:.8rem">' +
          window.MMGR.Utils.escapeHtml(p.name) +
          ' <span style="color:var(--slate);font-size:.7rem">(' +
          p.resources.length +
          ' resources, ' +
          newRes.length +
          ' new)</span></div>';
        if (newRes.length) {
          html +=
            '<div style="font-size:.72rem;color:var(--slate);margin:4px 0">New: ' +
            newRes.map(r => window.MMGR.Utils.escapeHtml(r.name)).join(', ') +
            '</div>';
          html +=
            '<button class="btn btn-g btn-s" style="font-size:.7rem" data-action="doImportResources" data-src-id="' +
            window.MMGR.Utils.escapeHtml(p.id) +
            '" data-count="' +
            newRes.length +
            '">Import ' +
            newRes.length +
            ' resource(s)</button>';
        } else {
          html +=
            '<div style="font-size:.72rem;color:var(--slate)">All resources already in this project.</div>';
        }
        html += '</div>';
      });
      html +=
        '<button class="btn btn-n btn-s" style="font-size:.7rem;margin-top:4px" data-action="closeImportModal">Cancel</button>';
      html += '</div>';
      const overlay = document.createElement('div');
      overlay.id = 'import-modal';
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:200;display:flex;align-items:center;justify-content:center';
      overlay.innerHTML = html;
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay || e.target.getAttribute('data-action') === 'closeImportModal') {
          overlay.remove();
        }
      });
      document.body.appendChild(overlay);
    },
    poolOpenLibrary: () => {
      if (window.MMGR.RenderResources && window.MMGR.RenderResources.poolOpenLibrary) {
        window.MMGR.RenderResources.poolOpenLibrary();
      }
    },
    poolCloseLibrary: () => {
      const m = document.getElementById('pool-modal');
      if (m) {
        m.remove();
      }
    },
    poolAddRow: el => {
      if (window.MMGR.RenderResources && window.MMGR.RenderResources.poolAddRow) {
        window.MMGR.RenderResources.poolAddRow(parseInt(el.getAttribute('data-idx'), 10));
      }
    },
    poolRefreshAndMerge: () => {
      if (window.MMGR.Pool) {
        window.MMGR.Pool.refreshAndMerge().then(function () {
          if (window.MMGR.Render) {
            window.MMGR.Render.renderResources();
          }
        });
      }
    },
    doImportResources: el => {
      // B11 (audit 2026-09-28): was bare ns/S/U/R/showToast - ReferenceError
      // on every click; routed through the published window.MMGR.* API.
      const srcId = el.getAttribute('data-src-id');
      if (!srcId) {
        return;
      }
      try {
        const srcState = JSON.parse(localStorage.getItem('mmgr_state_' + srcId));
        const srcRes = (srcState && srcState.resources) || [];
        const curNames = (window.MMGR.State.getState().resources || []).map(r =>
          r.name.toLowerCase()
        );
        const toImport = srcRes.filter(
          r => r.name && curNames.indexOf(r.name.toLowerCase()) === -1
        );
        if (!toImport.length) {
          window.MMGR.App.showToast('All resources already imported.', 'warn');
          return;
        }
        window.MMGR.State.updateState(function (st) {
          if (!st.resources) {
            st.resources = [];
          }
          toImport.forEach(function (r) {
            st.resources.push({
              id: window.MMGR.Utils.genShortId('R'),
              name: r.name,
              type: r.type || 'Labor',
              role: r.role || '',
              availability: r.availability || 100,
              rate: r.rate || 0,
              hoursAllocated: r.hoursAllocated || 0,
              utilization: 0
            });
          });
        });
        const modal = document.getElementById('import-modal');
        if (modal) {
          modal.remove();
        }
        window.MMGR.Render.renderResources();
        window.MMGR.App.showToast('Imported ' + toImport.length + ' resource(s).', 'ok');
      } catch (e) {
        window.MMGR.App.showToast('Import failed: ' + e.message, 'err');
      }
    },
    closeImportModal: () => {
      const m = document.getElementById('import-modal');
      if (m) {
        m.remove();
      }
    },
    saveAsTemplate: () => {
      const name = prompt('Template name:');
      // OWNER 2026-09-24 (silent-errors wave): prompt-cancel or an empty name
      // fell through silently - no feedback at all. Name it, confirm with a
      // toast, and refresh the list (save mutates state but nothing re-rendered
      // #template-list until the next full render).
      if (name === null) {
        return;
      } // user cancelled
      const clean = name.trim();
      if (!clean) {
        window.MMGR.App.showToast('Give the template a name first.', 'warn');
        return;
      }
      window.MMGR.Templates.saveAsTemplate(clean);
      if (window.MMGR.Render && window.MMGR.Render.renderTemplates) {
        window.MMGR.Render.renderTemplates();
      }
      window.MMGR.App.showToast('Template saved: ' + clean, 'ok');
    },
    applyTemplate: el => {
      const tplId = el.getAttribute('data-tpl-id');
      if (tplId) {
        window.MMGR.Templates.applyTemplate(tplId);
      }
    },
    deleteTemplate: el => {
      const tplId = el.getAttribute('data-tpl-id');
      if (tplId && confirm('Delete this template?')) {
        window.MMGR.Templates.deleteTemplate(tplId);
        if (window.MMGR.Render && window.MMGR.Render.renderTemplates) {
          window.MMGR.Render.renderTemplates();
        }
        window.MMGR.App.showToast('Template deleted.', 'ok');
      }
    },
    outdentTask: el => window.MMGR.Tasks.outdentTask(el.getAttribute('data-id')),
    tglPhase: el => window.MMGR.Tasks.tglPhase(el.getAttribute('data-id')),
    tglWeather: el => window.MMGR.Tasks.tglWeather(el.getAttribute('data-id')),
    tglLeadTime: el => window.MMGR.Tasks.tglLeadTime(el.getAttribute('data-id')),
    openWbsImport: () => window.MMGR.Tasks.openWbsImport(),
    wiPreview: () => window.MMGR.Tasks.wiPreview(),
    wiCommit: () => window.MMGR.Tasks.wiCommit(),
    openImportDates: () => window.MMGR.Tasks.openImportDates(),
    idPreview: () => window.MMGR.Tasks.idPreview(),
    idCommit: () => window.MMGR.Tasks.idCommit(),
    idReadWithAi: () => window.MMGR.Tasks.idReadWithAi(),
    idFilePickTrigger: () => window.MMGR.Tasks.idFilePickTrigger(),
    idFilePick: el => window.MMGR.Tasks.idFilePick(el),
    openAiMailbox: () => window.MMGR.Watch.openMailbox(),
    closeAiMailbox: () => window.MMGR.Watch.closeMailbox(),
    closeAiMailboxBg: (el, e) => {
      if (e && e.target && e.target.id === 'ai-mailbox') {
        window.MMGR.Watch.closeMailbox();
      }
    },
    dismissAiNote: el => window.MMGR.Watch.dismissNote(el.getAttribute('data-id')),
    clearAiMailbox: () => window.MMGR.Watch.clearMailbox(),
    // MONOLITH-FEATURE-PARITY-DIRECTIVES RESTORE-2: Import Dates 'Copy List'.
    copyIdTemplate: () => window.MMGR.Tasks.copyIdTemplate(),
    saveSprint: () => window.MMGR.Tasks.saveSprint(),
    addRisk: () => window.MMGR.Risks.addRisk(),
    delRisk: el => window.MMGR.Risks.delRisk(parseInt(el.getAttribute('data-idx'))),
    toggleRiskIssue: el => window.MMGR.Risks.toggleRiskIssue(parseInt(el.getAttribute('data-idx'))),
    delIssue: el => window.MMGR.Risks.delIssue(parseInt(el.getAttribute('data-idx'))),
    // MONOLITH-FEATURE-PARITY-DIRECTIVES RESTORE-1: risk matrix
    // click-to-filter (view-only , filtering the list, not mutating state).
    riskMatrixCell: el =>
      window.MMGR.Render.riskMatrixCell(el.getAttribute('data-prob'), el.getAttribute('data-imp')),
    riskMatrixClear: () => window.MMGR.Render.clearRiskFilter(),
    // MONOLITH-FEATURE-PARITY-DIRECTIVES RESTORE-7: WBS schedule-issues
    // banner toggle (view-only).
    tglWbsIssues: () => window.MMGR.Render.toggleWbsIssues(),
    addResource: () => window.MMGR.Resources.addResource(),
    delResource: el => window.MMGR.Resources.delResource(parseInt(el.getAttribute('data-idx'))),
    pushResourcesToBudget: () => window.MMGR.Resources.pushResourcesToBudget(),
    addBudgetLine: () => window.MMGR.Budget.addBudgetLine(),
    delBudgetLine: el => window.MMGR.Budget.delBudgetLine(parseInt(el.getAttribute('data-idx'))),
    updEnvelope: (el, e) => window.MMGR.Budget.updEnvelope(el.value, e && e.type),
    addStake: () => window.MMGR.Stakeholders.addStake(),
    delStake: el => window.MMGR.Stakeholders.delStake(parseInt(el.getAttribute('data-idx'))),
    // MARKET-FEATURE-ROADMAP A3/A4 (T8 REBUILD 2026-08-16): bid leveling +
    // Go/No-Go scoring actions , modal-created packages, leveled grid,
    // weighted star scorecard. State mutations are deliberately NOT in
    // READONLY_SAFE_ACTIONS; bidProposal/bidClarify open links (safe).
    bidAdd: () => window.MMGR.Bids.openBidPkgModal(),
    bidEdit: el => window.MMGR.Bids.openBidPkgModal(parseInt(el.getAttribute('data-pkg'))),
    bidModalAddItem: () => window.MMGR.Bids.bidModalAddItem(),
    bidModalDelItem: el => window.MMGR.Bids.bidModalDelItem(parseInt(el.getAttribute('data-idx'))),
    bidPkgSave: () => window.MMGR.Bids.bidPkgSave(),
    closeBidPkg: () => window.MMGR.Bids.closeBidPkgModal(),
    closeBidPkgBg: (el, e) => {
      if (e.target === el) {
        window.MMGR.Bids.closeBidPkgModal();
      }
    },
    bidSubAdd: el => window.MMGR.Bids.addSub(parseInt(el.getAttribute('data-pkg'))),
    bidSubDel: el =>
      window.MMGR.Bids.delSub(
        parseInt(el.getAttribute('data-pkg')),
        parseInt(el.getAttribute('data-sid'))
      ),
    bidPkgUpd: (el, e) =>
      window.MMGR.Bids.updPkg(
        parseInt(el.getAttribute('data-pkg')),
        el.getAttribute('data-field'),
        el.value,
        e && e.type
      ),
    bidSubUpd: (el, e) =>
      window.MMGR.Bids.updSub(
        parseInt(el.getAttribute('data-pkg')),
        parseInt(el.getAttribute('data-sid')),
        el.getAttribute('data-field'),
        el.value,
        e && e.type
      ),
    bidLineUpd: (el, e) =>
      window.MMGR.Bids.updLine(
        parseInt(el.getAttribute('data-pkg')),
        parseInt(el.getAttribute('data-lid')),
        el.getAttribute('data-field'),
        el.value,
        e && e.type
      ),
    bidLineDel: el =>
      window.MMGR.Bids.delLine(
        parseInt(el.getAttribute('data-pkg')),
        parseInt(el.getAttribute('data-lid'))
      ),
    bidAmount: (el, e) =>
      window.MMGR.Bids.updAmount(
        parseInt(el.getAttribute('data-pkg')),
        parseInt(el.getAttribute('data-sid')),
        parseInt(el.getAttribute('data-lid')),
        el.value,
        e && e.type
      ),
    bidAddLine: el => window.MMGR.Bids.addLine(parseInt(el.getAttribute('data-pkg'))),
    bidAward: el =>
      window.MMGR.Bids.awardSub(
        parseInt(el.getAttribute('data-pkg')),
        parseInt(el.getAttribute('data-sid'))
      ),
    bidProposal: el =>
      window.MMGR.Bids.openProposal(
        parseInt(el.getAttribute('data-pkg')),
        parseInt(el.getAttribute('data-sid'))
      ),
    bidClarify: el =>
      window.MMGR.Bids.clarifySub(
        parseInt(el.getAttribute('data-pkg')),
        parseInt(el.getAttribute('data-sid'))
      ),
    bidDelPkg: el => window.MMGR.Bids.delBidPackage(parseInt(el.getAttribute('data-pkg'))),
    gonogoAdd: () => window.MMGR.Bids.addGoNoGo(),
    gonogoUpd: (el, e) =>
      window.MMGR.Bids.updGoNoGo(
        parseInt(el.getAttribute('data-idx')),
        el.getAttribute('data-field'),
        el.value,
        e && e.type
      ),
    gonogoCatUpd: (el, e) =>
      window.MMGR.Bids.updGoNoGoCat(
        parseInt(el.getAttribute('data-idx')),
        parseInt(el.getAttribute('data-cidx')),
        el.getAttribute('data-field'),
        el.value,
        e && e.type
      ),
    gonogoCritUpd: (el, e) =>
      window.MMGR.Bids.updGoNoGoCrit(
        parseInt(el.getAttribute('data-idx')),
        parseInt(el.getAttribute('data-cidx')),
        parseInt(el.getAttribute('data-ridx')),
        el.getAttribute('data-field'),
        el.value,
        e && e.type
      ),
    gonogoStar: el =>
      window.MMGR.Bids.setGoNoGoStar(
        parseInt(el.getAttribute('data-idx')),
        parseInt(el.getAttribute('data-cidx')),
        parseInt(el.getAttribute('data-ridx')),
        parseInt(el.getAttribute('data-val'))
      ),
    gonogoAddCat: el => window.MMGR.Bids.addGoNoGoCat(parseInt(el.getAttribute('data-idx'))),
    gonogoDelCat: el =>
      window.MMGR.Bids.delGoNoGoCat(
        parseInt(el.getAttribute('data-idx')),
        parseInt(el.getAttribute('data-cidx'))
      ),
    gonogoAddCrit: el =>
      window.MMGR.Bids.addGoNoGoCriterion(
        parseInt(el.getAttribute('data-idx')),
        parseInt(el.getAttribute('data-cidx'))
      ),
    gonogoDelCrit: el =>
      window.MMGR.Bids.delGoNoGoCriterion(
        parseInt(el.getAttribute('data-idx')),
        parseInt(el.getAttribute('data-cidx')),
        parseInt(el.getAttribute('data-ridx'))
      ),
    gonogoDel: el => window.MMGR.Bids.delGoNoGo(parseInt(el.getAttribute('data-idx'))),
    addChange: () => window.MMGR.Changes.addChange(),
    delChange: el => window.MMGR.Changes.delChange(parseInt(el.getAttribute('data-idx'))),
    addLog: () => window.MMGR.Log.addLog(),
    delLog: el => window.MMGR.Log.delLog(parseInt(el.getAttribute('data-idx'))),
    addCloseItem: () => window.MMGR.Closure.addCloseItem(),
    delCloseItem: el => window.MMGR.Closure.delCloseItem(parseInt(el.getAttribute('data-idx'))),
    addComms: () => window.MMGR.Comms.addComms(),
    delComms: el => window.MMGR.Comms.delComms(parseInt(el.getAttribute('data-idx'))),
    addDoc: () => window.MMGR.Documents.addDoc(),
    delDoc: el => window.MMGR.Documents.delDoc(parseInt(el.getAttribute('data-idx'))),
    // MARKET-FEATURE-ROADMAP C1/C2/C3: RFI + Submittal + Punch List actions.
    addRfi: () => window.MMGR.Rfis.addRfi(),
    delRfi: el => window.MMGR.Rfis.delRfi(parseInt(el.getAttribute('data-idx'))),
    addSubmittal: () => window.MMGR.Submittals.addSubmittal(),
    delSubmittal: el => window.MMGR.Submittals.delSubmittal(parseInt(el.getAttribute('data-idx'))),
    addPunch: () => window.MMGR.PunchList.addPunch(),
    delPunch: el => window.MMGR.PunchList.delPunch(parseInt(el.getAttribute('data-idx'))),
    // PART H (owner 2026-10-16): Procurement tab , supplier price book +
    // AI quote panel (js/mmgr-procurement.js, ns.Proc). All state-mutating,
    // except selVendor (disclosure/select, view-only) and procQuoteCopy
    // (clipboard) which are listed in READONLY_SAFE_ACTIONS below.
    addPvendor: () => window.MMGR.Proc.addPvendor(),
    delPvendor: el => window.MMGR.Proc.delPvendor(el),
    updPvendor: (el, e) => window.MMGR.Proc.updPvendor(el, e),
    selVendor: el => window.MMGR.Proc.selVendor(el),
    addPitem: () => window.MMGR.Proc.addPitem(),
    delPitem: el => window.MMGR.Proc.delPitem(el),
    updPitem: (el, e) => window.MMGR.Proc.updPitem(el, e),
    procQuote: () => window.MMGR.Proc.procQuote(),
    procQuoteVendor: el => window.MMGR.Proc.procQuoteVendor(el),
    procQuoteTone: el => window.MMGR.Proc.procQuoteTone(el),
    procQuoteCopy: () => window.MMGR.Proc.procQuoteCopy(),
    // P8 RFQ email pack: terms read live (ephemeral), mailto opens the
    // generated quote in the mail client with NO new numbers (book only).
    procQuoteTerm: el => window.MMGR.Proc.procQuoteTerm(el),
    procQuoteMailto: () => window.MMGR.Proc.procQuoteMailto(),
    // P9 purchase order PDF from an awarded quote (export only, never state)
    procPo: () => window.MMGR.Proc.procPo(),
    // P3 import + P4 compare (directive 2026-10-18)
    procImport: () => window.MMGR.Proc.procImport(),
    procImportCancel: () => window.MMGR.Proc.procImportCancel(),
    procImportFile: el => window.MMGR.Proc.procImportFile(el),
    procImportMap: () => window.MMGR.Proc.procImportMap(),
    procImportApply: () => window.MMGR.Proc.procImportApply(),
    procCompare: () => window.MMGR.Proc.procCompare(),
    procCompareClose: () => window.MMGR.Proc.procCompareClose(),
    // P5 quantity break pricing (directive 2026-10-18). openTiers/closeTiers/
    // tierPreview are pure view (READONLY_SAFE below); addTier/delTier/updTier
    // mutate priceTiers and stay blocked in view-only mode.
    openTiers: el => window.MMGR.Proc.openTiers(el),
    closeTiers: () => window.MMGR.Proc.closeTiers(),
    // P10 lead time -> schedule: open/close are pure view (a disclosure card);
    // procLeadLink mutates the task's leadTime/dates and stays blocked in
    // view-only (same policy as addTier/delTier).
    procLead: el => window.MMGR.Proc.procLead(el),
    closeLead: () => window.MMGR.Proc.closeLead(),
    procLeadLink: () => window.MMGR.Proc.procLeadLink(),
    addTier: () => window.MMGR.Proc.addTier(),
    delTier: el => window.MMGR.Proc.delTier(el),
    updTier: (el, e) => window.MMGR.Proc.updTier(el, e),
    tierPreview: () => window.MMGR.Proc.tierPreview(),
    // P7 calculator -> RFQ: dismissing the handoff card clears the local draft.
    clearRfq: () => window.MMGR.Proc.clearRfq(),
    // MARKET-FEATURE-ROADMAP Section C batch 2 (state mutations , never
    // READONLY_SAFE): pay applications, inspections, incidents, handover,
    // warranty, drawing distribution log, permits.
    addPayApp: () => window.MMGR.PayApps.addPayApp(true),
    genPayApp: () => window.MMGR.PayApps.genPayApp(),
    delPayApp: el => window.MMGR.PayApps.delPayApp(parseInt(el.getAttribute('data-idx'))),
    addInspection: () => window.MMGR.Inspections.addInspection(),
    delInspection: el =>
      window.MMGR.Inspections.delInspection(parseInt(el.getAttribute('data-idx'))),
    addInspItem: el => window.MMGR.Inspections.addInspItem(parseInt(el.getAttribute('data-idx'))),
    delInspItem: el =>
      window.MMGR.Inspections.delInspItem(
        parseInt(el.getAttribute('data-idx')),
        parseInt(el.getAttribute('data-iidx'))
      ),
    inspItemToggle: el =>
      window.MMGR.Inspections.toggleInspItem(
        parseInt(el.getAttribute('data-idx')),
        parseInt(el.getAttribute('data-iidx'))
      ),
    updInspItem: el =>
      window.MMGR.Inspections.updInspItem(
        parseInt(el.getAttribute('data-idx')),
        parseInt(el.getAttribute('data-iidx')),
        el.getAttribute('data-field'),
        el.value
      ),
    addIncident: () => window.MMGR.Incidents.addIncident(),
    delIncident: el => window.MMGR.Incidents.delIncident(parseInt(el.getAttribute('data-idx'))),
    addHandoverItem: () => window.MMGR.Handover.addHandoverItem(),
    delHandoverItem: el =>
      window.MMGR.Handover.delHandoverItem(parseInt(el.getAttribute('data-idx'))),
    addWarranty: () => window.MMGR.Warranty.addWarranty(),
    delWarranty: el => window.MMGR.Warranty.delWarranty(parseInt(el.getAttribute('data-idx'))),
    addDrawLog: () => window.MMGR.DrawingLog.addDrawLog(),
    delDrawLog: el => window.MMGR.DrawingLog.delDrawLog(parseInt(el.getAttribute('data-idx'))),
    addPermit: () => window.MMGR.Permits.addPermit(),
    delPermit: el => window.MMGR.Permits.delPermit(parseInt(el.getAttribute('data-idx'))),
    addProcurement: () => window.MMGR.Procurement.addProcurement(),
    delProcurement: el =>
      window.MMGR.Procurement.delProcurement(parseInt(el.getAttribute('data-idx'))),
    addTimeEntry: () => window.MMGR.TimeTracking.addTimeEntry(),
    delTimeEntry: el =>
      window.MMGR.TimeTracking.delTimeEntry(parseInt(el.getAttribute('data-idx'))),
    addEquipment: () => window.MMGR.Equipment.addEquipment(),
    delEquipment: el => window.MMGR.Equipment.delEquipment(parseInt(el.getAttribute('data-idx'))),
    addKPI: () => window.MMGR.Charter.addKPI(),
    delKPI: el => window.MMGR.Charter.delKPI(parseInt(el.getAttribute('data-idx'))),
    openChartUp: () => window.MMGR.Charter.openChartUp(),
    closeChartUp: () => window.MMGR.Charter.closeChartUp(),
    closeChartUpBg: (el, e) => {
      if (e.target === el) {
        window.MMGR.Charter.closeChartUp();
      }
    },
    regenChartPrompt: () => window.MMGR.Charter.regenChartPrompt(),
    copyChartPrompt: () => window.MMGR.Charter.copyChartPrompt(),
    applyChartAIOutput: () => window.MMGR.Charter.applyChartAIOutput(),
    // MONOLITH-FEATURE-PARITY-DIRECTIVES RESTORE-5/6: Print Charter + Save
    // Charter (save mutates state and stays blocked in view-only; print is
    // view-only).
    printCharter: () => window.MMGR.Charter.printCharter(),
    saveCharter: () => window.MMGR.Charter.saveCharter(),
    cpAllPage: el => window.MMGR.App.cpAllPage(el.getAttribute('data-section')),
    cpFormats: el => window.MMGR.App.cpFormats(el.getAttribute('data-kind')),
    // MONOLITH-FEATURE-PARITY-DIRECTIVES RESTORE-3: one-click email template
    // generator (view-only , composes + copies, never mutates state).
    emailTpl: el => window.MMGR.App.emailTpl(el.getAttribute('data-kind')),
    exportGanttPNG: () => window.MMGR.App.exportGanttPNG(),
    exportGanttSVG: () => window.MMGR.App.exportGanttSVG(),
    exportGanttPDF: () => window.MMGR.App.exportGanttPDF(),
    // G8 export dialog: open/close + run; the background click closes.
    openGanttExport: () => window.MMGR.App.openGanttExport(),
    closeGanttExport: () => window.MMGR.App.closeGanttExport(),
    closeGanttExportBg: (el, e) => {
      if (e.target === el) {
        window.MMGR.App.closeGanttExport();
      }
    },
    ganttExportRun: () => window.MMGR.App.ganttExportRun(),
    wxGeocode: () => window.MMGR.App.wxGeocode(),
    wxUseLocation: () => window.MMGR.App.wxUseLocation(),
    wxRefresh: () => window.MMGR.App.wxRefresh(),
    wxSetView: el => window.MMGR.App.wxSetView(el),
    wxLogToday: () => window.MMGR.App.wxLogToday(),
    wxLogManual: () => window.MMGR.App.wxLogManual(),
    wxCopyNotice: () => window.MMGR.App.wxCopyNotice(),
    delWeatherLogEntry: el => window.MMGR.App.wxDelLogEntry(el),
    // MASTER-ACTION-PLAN-v3-STRICT Rank 1: claim package + slip cause tags.
    claimGenerate: () => window.MMGR.Claim.generate(),
    claimSetCause: el => window.MMGR.Claim.setCause(el.getAttribute('data-task'), el.value),
    // MASTER-ACTION-PLAN-v3-STRICT Rank 2.1: digest generation is a read-only
    // compose; pinning writes the reference point into state.
    digestGenerate: () => window.MMGR.Digest.generate(),
    digestPin: () => window.MMGR.Digest.pin(),
    meetSentiment: el => window.MMGR.Meetings.recordSentiment(el.getAttribute('data-val')),
    tglLeadtimeReview: el => window.MMGR.Tasks.tglLeadtimeReview(el.getAttribute('data-id')),
    openAiWin: () => window.MMGR.AiWin.open(),
    closeAiWin: () => window.MMGR.AiWin.close(),
    closeAiWinBg: (el, e) => {
      if (e.target === el) {
        window.MMGR.AiWin.close();
      }
    },
    aiPreset: el => window.MMGR.AiWin.preset(el.getAttribute('data-type')),
    aiAttachContext: () => window.MMGR.AiWin.attachContext(),
    aiCopy: () => window.MMGR.AiWin.copy(),
    aiClear: () => window.MMGR.AiWin.clear(),
    // Rank 2.3: real model wiring , run preset / run question / settings.
    aiRunPreset: el => window.MMGR.AiWin.runPreset(el.getAttribute('data-type')),
    aiRun: () => window.MMGR.AiWin.runQuestion(),
    aiCopyOut: () => window.MMGR.AiWin.copyOut(),
    aiSetTier: el => {
      window.MMGR.AiWin.setAiCfg({ tier: el.value });
      window.MMGR.AiWin.syncSettingsUI();
    },
    aiToggleMcp: el => {
      var pid = window.MMGR && MMGR.App && MMGR.App.projectId ? MMGR.App.projectId : '';
      if (pid) {
        try {
          localStorage.setItem('mmgr_mcp_toggle_' + pid, el.checked ? '1' : '0');
        } catch (e) {}
      }
    },
    aiVoiceToggle: () => {
      if (window.MMGR && MMGR.Voice) {
        MMGR.Voice.toggleAiRecording();
      }
    },
    // MERGED-AI-CONTROL (audit 1.2): the drawer's AI Assistant switch is now
    // the single AI on/off control , it reads/writes state.config.ai.tier
    // directly (flags.aiWindow is dropped as a gate). OFF -> tier 'off'; ON
    // -> restore the last non-off tier (default 'local').
    tglAiTier: el => window.MMGR.AiWin.tglDrawerTier(el),
    // AI-CLOUD-CONNECT-UI (DIR-2): no aiSetKey action , and no aiSetProvider /
    // aiSetEndpoint / aiSetModel actions either. The BYO provider select is
    // read directly by the Connect & Test flow, and the key is wired
    // directly in mmgr-ai.js (session vault only); setAiCfg drops apiKey
    // patches anyway , a key can never be persisted into project state.
    // Rank 3.4: viewport prompt answers write a device-level preference only
    // (localStorage, never project state) , safe in view-only. toggleFull is
    // a pure DOM class toggle.
    vpAccept: el => window.MMGR.Viewport.accept(el.getAttribute('data-section')),
    vpDismiss: el => window.MMGR.Viewport.dismiss(el.getAttribute('data-section')),
    vpFull: el => window.MMGR.Viewport.toggleFull(el.getAttribute('data-section')),
    // Rank 3.5 (PLAN-OF-ACTION-LIQUID-GLASS-UI): premium visual mode toggle ,
    // writes a device-level preference only (localStorage, never project
    // state), so it is safe in view-only, exactly like the viewport prefs.
    tglGlassMode: () => window.MMGR.App.tglGlassMode(),
    // Calculator toggle (floating draggable FAB).
    toggleCalc: () => {
      const C = window.MMGR.Calculator;
      if (C && C.toggle) {
        C.toggle();
      }
    },
    // THEME-SYSTEM-AND-MOBILE-UI-ACTION-PLAN §4.2: mobile nav drawer toggle.
    tglNav: () => window.MMGR.App.tglNav(),
    tglSidebar: () => window.MMGR.App.tglSidebar(),
    tglSidebarOpen: () => window.MMGR.App.tglSidebarOpen(),
    // Rank 4.5 (PLAN-OF-ACTION-AI-VOICE-SYNC-v1): optional Google identity
    // for sync , device-level label only, never a gate, safe in view-only.
    syncConnect: () => window.MMGR.App.syncConnect(),
    syncSignOut: () => window.MMGR.App.syncSignOut(),
    syncClientId: el => window.MMGR.App.syncClientId(el),
    syncDismissSuggest: () => window.MMGR.App.syncDismissSuggest(),
    // OWNER 2026-09-06: sidebar-bottom sign-in. Opens the #siom sheet
    // (the GIS prompt stays a fallback); closeSignIn closes it.
    openSignIn: () => window.MMGR.App.openSignInModal(),
    closeSignIn: () => window.MMGR.App.closeSignInModal(),
    // GOOGLE-DRIVE-BACKUP: optional Drive backup/restore controls in the
    // Controls drawer (project.html). Backup is export-equivalent (reads the
    // workspace, writes Drive + a device pref), restore is import-equivalent
    // (confirm-gated, overwrites local workspace), and the auto-interval is a
    // device pref , all user-initiated, never gating. GoogleAuth is optional,
    // so every handler guards before touching it (zero-throw module).
    // PART F T9: driveBackup is an offline-copy surface , refused while a
    // cloud share code is held (the recipient must not copy the project to
    // their own Drive).
    driveBackup: () => {
      if (window.MMGR.App && window.MMGR.App.cloudExportBlocked('driveBackup')) {
        return;
      }
      const G = window.MMGR.GoogleAuth;
      if (G && G.triggerBackup) {
        G.triggerBackup();
      }
    },
    driveRestore: () => {
      const G = window.MMGR.GoogleAuth;
      if (G && G.triggerRestore) {
        G.triggerRestore();
      }
    },
    driveAutoInterval: el => {
      const G = window.MMGR.GoogleAuth;
      if (G && G.setAutoIntervalFrom) {
        G.setAutoIntervalFrom(el);
      }
    },
    driveSetPass: el => {
      const G = window.MMGR.GoogleAuth;
      if (G && G.setDrivePassFrom) {
        G.setDrivePassFrom(el);
      }
    },
    // CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 1: optional Cloud Backup section
    // (owner-code create/save/load/recover + Google sign-in for recovery).
    // Same zero-throw pattern as the Drive entries above.
    cloudCreate: () => {
      const C = window.MMGR.Cloud;
      if (C && C.createProject) {
        C.createProject();
      }
    },
    cloudClaim: () => {
      const C = window.MMGR.Cloud;
      if (C && C.claimProject) {
        C.claimProject();
      }
    },
    cloudUpgrade: () => {
      const C = window.MMGR.Cloud;
      if (C && C.cloudUpgrade) {
        C.cloudUpgrade();
      }
    },
    cloudResendVerify: () => {
      const C = window.MMGR.Cloud;
      if (C && C.cloudResendVerify) {
        C.cloudResendVerify();
      }
    },
    cloudSave: () => {
      const C = window.MMGR.Cloud;
      if (C && C.saveToCloud) {
        C.saveToCloud();
      }
    },
    cloudLoad: () => {
      const C = window.MMGR.Cloud;
      if (C && C.loadFromCloud) {
        C.loadFromCloud();
      }
    },
    cloudRecover: () => {
      const C = window.MMGR.Cloud;
      if (C && C.recoverCode) {
        C.recoverCode();
      }
    },
    // GAP-AUDIT-CLOUD-31: unlink (owner-only, deletes the CLOUD copy, keeps
    // local data) + the shown-once editor-code banner's Copy/Done actions.
    cloudUnlink: () => {
      const C = window.MMGR.Cloud;
      if (C && C.unlinkProject) {
        C.unlinkProject();
      }
    },
    cloudWebhookList: () => {
      const C = window.MMGR.Cloud;
      if (C && C.webhookList) {
        C.webhookList();
      }
    },
    cloudWebhookAdd: () => {
      const C = window.MMGR.Cloud;
      if (C && C.webhookAdd) {
        C.webhookAdd();
      }
    },
    cloudWebhookDel: el => {
      const C = window.MMGR.Cloud;
      if (C && C.webhookDel) {
        C.webhookDel(el && el.getAttribute('data-id'));
      }
    },
    cloudCopyEditorCode: el => {
      const C = window.MMGR.Cloud;
      if (C && C.copyEditorCode && el) {
        C.copyEditorCode(el.getAttribute('data-code'));
      }
    },
    cloudEditorCodeDone: () => {
      const C = window.MMGR.Cloud;
      if (C && C.editorCodeDone) {
        C.editorCodeDone();
      }
    },
    cloudCopyCode: () => {
      const C = window.MMGR.Cloud;
      if (C && C.copyCode) {
        C.copyCode();
      }
    },
    mcpCopyUrl: () => {
      var inp = document.getElementById('mcp-url');
      if (inp && inp.value) {
        navigator.clipboard
          .writeText(inp.value)
          .then(function () {
            var st = document.getElementById('mcp-status');
            if (st) {
              st.textContent = 'Copied to clipboard.';
            }
            setTimeout(function () {
              var s = document.getElementById('mcp-status');
              if (s) {
                s.textContent = '';
              }
            }, 2000);
          })
          .catch(function () {
            inp.select();
            document.execCommand('copy');
          });
      }
    },
    // REGULAR TERMINAL notifier (the non-cloud stdio connector card). Same
    // shape as mcpCopyUrl above: copy the config field, announce it through
    // the card's own role=status live region, then clear it. A copy is safe in
    // read-only mode (no state change) so it needs no readonly guard.
    terminalCopyUrl: () => {
      var inp = document.getElementById('terminal-mcp-url');
      if (inp && inp.value) {
        navigator.clipboard
          .writeText(inp.value)
          .then(function () {
            var st = document.getElementById('terminal-status');
            if (st) {
              st.textContent =
                'Copied to clipboard. Remember to change the two placeholder paths to your own.';
            }
            setTimeout(function () {
              var s = document.getElementById('terminal-status');
              if (s) {
                s.textContent = '';
              }
            }, 4000);
          })
          .catch(function () {
            inp.select();
            document.execCommand('copy');
            if (document.getElementById('terminal-status')) {
              document.getElementById('terminal-status').textContent = 'Copied to clipboard.';
            }
          });
      }
    },
    cloudSignIn: () => {
      const C = window.MMGR.Cloud;
      if (C && C.signIn) {
        C.signIn();
      }
    },
    cloudLoadWithCode: () => {
      const C = window.MMGR.Cloud;
      if (C && C.loadWithCode) {
        C.loadWithCode();
      }
    },
    // SYNC BOND (Task 13): explicit re-sync for bonded projects + the
    // one-time offer's Later dismiss (both are drawer actions, no mutation).
    cloudResync: () => {
      const C = window.MMGR.Cloud;
      if (C && C.cloudResync) {
        C.cloudResync();
      }
    },
    cloudBondLater: () => {
      const C = window.MMGR.Cloud;
      if (C && C.cloudBondLater) {
        C.cloudBondLater();
      }
    },
    // CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 2/3: editor-code management
    // (create/list/revoke , owner-only, enforced server-side) and the
    // changelog view/revert (owner-only). Same zero-throw pattern as the
    // Phase 1 entries above.
    cloudEditorCreate: () => {
      const C = window.MMGR.Cloud;
      if (C && C.createEditor) {
        C.createEditor();
      }
    },
    cloudClientCreate: () => {
      const C = window.MMGR.Cloud;
      if (C && C.createClientCode) {
        C.createClientCode();
      }
    },
    cloudClientList: () => {
      const C = window.MMGR.Cloud;
      if (C && C.listClientCodes) {
        C.listClientCodes();
      }
    },
    cloudClientRevoke: el => {
      const C = window.MMGR.Cloud;
      if (C && C.revokeClientCode) {
        C.revokeClientCode(el && el.getAttribute('data-id'));
      }
    },
    cloudEditorList: () => {
      const C = window.MMGR.Cloud;
      if (C && C.listEditors) {
        C.listEditors();
      }
    },
    cloudEditorRevoke: el => {
      const C = window.MMGR.Cloud;
      if (C && C.revokeEditor) {
        C.revokeEditor(el && el.getAttribute('data-id'));
      }
    },
    // PROJECT API KEYS (owner 2026-09-15): same owner-only, cloud-only family.
    cloudApiKeyCreate: () => {
      const C = window.MMGR.Cloud;
      if (C && C.createApiKey) {
        C.createApiKey();
      }
    },
    cloudApiKeyList: () => {
      const C = window.MMGR.Cloud;
      if (C && C.listApiKeys) {
        C.listApiKeys();
      }
    },
    cloudApiKeyRevoke: el => {
      const C = window.MMGR.Cloud;
      if (C && C.revokeApiKey) {
        C.revokeApiKey(el && el.getAttribute('data-id'));
      }
    },
    // Share & Access sub-tabs (owner 2026-09-15): switch without a re-render.
    cloudShareTab: el => {
      const tab = el && el.getAttribute('data-tab');
      if (!tab) {
        return;
      }
      const wrap = document.getElementById('ctrl-share');
      if (!wrap) {
        return;
      }
      wrap.querySelectorAll('.share-subtab').forEach(function (b) {
        const on = b.getAttribute('data-tab') === tab;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      wrap.querySelectorAll('.share-subpane').forEach(function (p) {
        p.hidden = p.getAttribute('data-pane') !== tab;
      });
    },
    cloudLogList: () => {
      const C = window.MMGR.Cloud;
      if (C && C.listLog) {
        C.listLog();
      }
    },
    cloudLogRevert: el => {
      const C = window.MMGR.Cloud;
      if (C && C.revertLog) {
        C.revertLog(el && el.getAttribute('data-id'));
      }
    },
    cloudLogToggleDiffs: el => {
      const C = window.MMGR.Cloud;
      if (C && C.toggleDiffs) {
        C.toggleDiffs(el && el.getAttribute('data-id'));
      }
    },
    cloudDropEditor: () => {
      const C = window.MMGR.Cloud;
      if (C && C.dropEditor) {
        C.dropEditor();
      }
    },
    // CLOUD-FIRST SYNC (PART 3, approved 2026-08-17): offline copies +
    // broadcast. cloudMakeCopy registers this device (view-only);
    // cloudUpdateCopy pulls the newest snapshot (no full reload);
    // cloudRemoveCopy unregisters; cloudBroadcast + cloudAutoBroadcast are
    // the owner's manual + automatic broadcast controls; cloudOfflineRemove
    // drops one registered copy from the owner's list.
    cloudMakeCopy: () => {
      const C = window.MMGR.Cloud;
      if (C && C.cloudMakeCopy) {
        C.cloudMakeCopy();
      }
    },
    cloudUpdateCopy: () => {
      const C = window.MMGR.Cloud;
      if (C && C.cloudUpdateCopy) {
        C.cloudUpdateCopy();
      }
    },
    cloudRemoveCopy: () => {
      const C = window.MMGR.Cloud;
      if (C && C.cloudRemoveCopy) {
        C.cloudRemoveCopy();
      }
    },
    cloudBroadcast: () => {
      const C = window.MMGR.Cloud;
      if (C && C.cloudBroadcast) {
        C.cloudBroadcast();
      }
    },
    cloudAutoBroadcast: () => {
      const C = window.MMGR.Cloud;
      if (C && C.cloudAutoBroadcast) {
        C.cloudAutoBroadcast();
      }
    },
    cloudOfflineRemove: el => {
      const C = window.MMGR.Cloud;
      if (C && C.cloudOfflineRemove) {
        C.cloudOfflineRemove(el && el.getAttribute('data-id'));
      }
    },
    // REVIEW QUEUE (2026-08-17, approved "always on"): owner review list +
    // accept/reject decisions; cloudReviewMine is the editor's own status.
    cloudReviewList: () => {
      const C = window.MMGR.Cloud;
      if (C && C.cloudReviewList) {
        C.cloudReviewList();
      }
    },
    cloudReviewMine: () => {
      const C = window.MMGR.Cloud;
      if (C && C.cloudReviewMine) {
        C.cloudReviewMine();
      }
    },
    cloudReviewAccept: el => {
      const C = window.MMGR.Cloud;
      if (C && C.cloudReviewAccept) {
        C.cloudReviewAccept(el && el.getAttribute('data-id'));
      }
    },
    cloudReviewReject: el => {
      const C = window.MMGR.Cloud;
      if (C && C.cloudReviewReject) {
        C.cloudReviewReject(el && el.getAttribute('data-id'));
      }
    },
    cloudReviewToggleDiffs: el => {
      const C = window.MMGR.Cloud;
      if (C && C.reviewToggleDiffs) {
        C.reviewToggleDiffs(el && el.getAttribute('data-id'));
      }
    },
    // IN-PROJECT DELETE (owner 2026-08-17): Settings > Controls > Danger
    // Zone , confirm modal + password verify + the owner-only soft delete.
    cloudDeleteOpen: () => {
      const C = window.MMGR.Cloud;
      if (C && C.cloudDeleteOpen) {
        C.cloudDeleteOpen();
      }
    },
    cloudDeleteClose: () => {
      const C = window.MMGR.Cloud;
      if (C && C.cloudDeleteClose) {
        C.cloudDeleteClose();
      }
    },
    // HOLD-TO-DELETE (owner 2026-09-17): the danger-zone confirm fires from
    // the 10s hold listeners below, never from a click (a synthetic click
    // after a held pointerup must not double-fire the delete).
    cloudDeleteConfirm: () => {},
    cascadeGantt: () => window.MMGR.App.cascadeGantt(),
    toggleCritical: el => window.MMGR.App.toggleCritical(el),
    tglLeadtimeLane: el => window.MMGR.App.tglLeadtimeLane(el),
    populateSprint: () => window.MMGR.App.populateSprint(),
    openPrompt: el => window.MMGR.App.openPrompt(el.getAttribute('data-type')),
    openDrwToSave: () => window.MMGR.App.openDrwToSave(),
    openDrwToPrompts: el => window.MMGR.App.openDrwToPrompts(el.getAttribute('data-type')),
    bkToggle: () => window.MMGR.App.bkToggle(),
    bkCloud: () => window.MMGR.App.bkCloud(),
    // PART F T9 (no-offline-copy): export/download are refused while a cloud
    // share code is held , the recipient must not leave with the project file.
    saveProjectFile: () => {
      if (window.MMGR.App && window.MMGR.App.cloudExportBlocked('saveProjectFile')) {
        return;
      }
      window.MMGR.App.saveProjectFile();
    },
    saveBaseline: () => window.MMGR.App.saveBaseline(),
    restoreBaseline: () => window.MMGR.App.restoreBaseline(),
    undo: () => window.MMGR.App.undo(),
    redo: () => window.MMGR.App.redo(),
    setRegion: el => window.MMGR.App.setRegion(el.value),
    setDeadline: el => window.MMGR.App.setDeadline(el.value),
    cfmOk: () => window.MMGR.App.cfmOk(),
    cfmCancel: () => window.MMGR.App.cfmCancel(),
    keepMine: () => window.MMGR.App.keepMine(),
    keepTheirs: () => window.MMGR.App.keepTheirs(),
    openOM: () => {
      if (window.MMGR.App && window.MMGR.App.cloudExportBlocked('openOM')) {
        return;
      }
      window.MMGR.App.openOM();
    },
    closeOM: () => window.MMGR.App.closeOM(),
    cpOut: () => {
      if (window.MMGR.App && window.MMGR.App.cloudExportBlocked('cpOut')) {
        return;
      }
      window.MMGR.App.cpOut();
    },
    loadClip: () => window.MMGR.App.loadClip(),
    openDrw: () => window.MMGR.App.openDrw(),
    closeDrw: () => window.MMGR.App.closeDrw(),
    // DIR-3: Core-Mode onboarding callout , jump to the pack toggles / dismiss.
    openPacks: () => window.MMGR.App.openPacks(),
    dismissPacksCallout: () => window.MMGR.App.dismissPacksCallout(),
    undoClr: () => window.MMGR.App.undoClr(),
    closeMLC: () => window.MMGR.App.closeMLC(),
    closeWbsImport: () => window.MMGR.Tasks.closeWbsImport(),
    closeWbsImportBg: (el, e) => {
      if (e.target === el) {
        window.MMGR.Tasks.closeWbsImport();
      }
    },
    closeImportDates: () => window.MMGR.Tasks.closeImportDates(),
    closeImportDatesBg: (el, e) => {
      if (e.target === el) {
        window.MMGR.Tasks.closeImportDates();
      }
    },
    addRaciTaskFromPicker: el => {
      window.MMGR.Raci.addRaciTaskFromPicker(el.value);
      el.value = '';
    },
    addRaciPersonFromPicker: el => {
      window.MMGR.Raci.addRaciPersonFromPicker(el.value);
      el.value = '';
    },
    cycleRaci: (el, ev) =>
      window.MMGR.Raci.cycleRaci(el.getAttribute('data-task'), el.getAttribute('data-person'), ev),
    // Settings panel
    setUserName: el => window.MMGR.App.setUserName(el.value),
    tglTheme: el => {
      window.MMGR.App.tglTheme();
    },
    // Performance Mode toggle (owner 2026-09-06): trims heavy CSS blur/shadow
    // layers + 3D tilt. Mirrors mmgr-perf.js which owns the localStorage slot
    // and the [data-perf] attribute on <html>. Safe in view-only (device pref).
    // S-2 PRIVACY (audit 2026-10-18, 8.2 item 7): the app's Settings >
    // Privacy toggle is the app-side of the consent choice. It writes the
    // same record the public banner writes and mirrors it into the cookie
    // the Worker's CSP reads, so turning it off here really does block the
    // analytics script on the next page load. Device-level, never project
    // state - which is why it is in READONLY_SAFE_ACTIONS below.
    tglConsentStat: el => {
      const C = window.MMGR && window.MMGR.Consent;
      if (!C || !C.save) {
        return;
      }
      C.save(!!el.checked);
      if (window.MMGR && MMGR.App && MMGR.App.showToast) {
        MMGR.App.showToast(
          el.checked
            ? 'Usage statistics are on. We count visits to the public pages.'
            : 'Usage statistics are off. Nothing is counted.',
          'ok'
        );
      }
    },
    tglPerfMode: el => {
      const P = window.MMGR.Perf;
      if (P && P.set) {
        P.set(el.checked);
      }
      // OWNER 2026-09-15: perf mode now also gates the starry WebGL shader.
      // Re-sync immediately so turning it OFF tears the running canvas down
      // (and turning it ON brings the background back on capable machines).
      if (window.MMGR && MMGR.Glass && MMGR.Glass.sync) {
        MMGR.Glass.sync();
      }
    },
    tglCh: el => {
      window.MMGR.App.tglCh();
    },
    // M-2 Your data: export is a device-level read+download (safe in view-only);
    // deleteAccount re-auths against the Worker and is deliberately NOT in
    // READONLY_SAFE_ACTIONS (a viewer cannot delete the owner's account).
    exportMyData: () => window.MMGR.App.exportMyData(),
    deleteAccount: el => window.MMGR.App.deleteAccount(el),
    tglFlag: el => window.MMGR.App.tglFlag(el),
    clearErrorLog: () => window.MMGR.App.clearErrorLog(),
    // DIR-1a/1b: error log export (view-only) + remote-reporting toggle/URL
    // (device-level preference, not project state).
    copyErrorLog: () => window.MMGR.App.copyErrorLog(),
    downloadErrorLog: () => window.MMGR.App.downloadErrorLog(),
    tglErrReport: el => window.MMGR.App.tglErrReport(),
    // MASTER-ACTION-PLAN Rank 6.1 , sanitized report package (read-only).
    reportIssueCopy: () => window.MMGR.App.reportIssueCopy(),
    reportIssueDownload: () => window.MMGR.App.reportIssueDownload(),
    tglReportContext: () => window.MMGR.App.tglReportContext(),
    setErrWebhook: el => window.MMGR.App.setErrWebhook(el),
    // Rank 3.1: Core Mode vs Advanced Packs , toggling a pack mutates
    // state.packs (blocked in view-only, like every other write). Same
    // checkbox convention as tglFlag: Chrome has already flipped `checked`
    // before this runs, so read it as-is (no manual flip, no preventDefault).
    tglPack: el => {
      const pack = el.getAttribute('data-pack');
      if (!pack) {
        return;
      }
      const on =
        el.type === 'checkbox'
          ? el.checked
          : window.MMGR.State.getState().packs &&
            window.MMGR.State.getState().packs[pack] !== false;
      window.MMGR.State.updateState(function (s) {
        if (!s.packs) {
          s.packs = {};
        }
        s.packs[pack] = on;
        // DIR-3: once any pack has EVER been turned on, the Core-Mode nudge
        // stays hidden forever even if every pack is switched off again.
        if (on) {
          s.packsEverEnabled = true;
        }
      });
      if (window.MMGR.Render && window.MMGR.Render.renderPacks) {
        window.MMGR.Render.renderPacks();
      }
      if (window.MMGR.Render && window.MMGR.Render.syncPackChips) {
        window.MMGR.Render.syncPackChips();
      }
      if (window.MMGR.App && window.MMGR.App.showToast) {
        window.MMGR.App.showToast(
          'Advanced pack ' + pack + ' turned ' + (on ? 'on' : 'off') + '.',
          'ok'
        );
      }
    },
    tglLock: () => window.MMGR.App.tglLock(),
    setWorkWeek: el => window.MMGR.App.setWorkWeek(el.value),
    loadProjectFileClick: () => {
      document.getElementById('load-file').click();
    },
    loadProjectFile: el => window.MMGR.App.loadProjectFile({ target: el }),
    mergeProjectFileClick: () => {
      document.getElementById('merge-file').click();
    },
    mergeProjectFile: el => window.MMGR.App.mergeProjectFile({ target: el }),
    print: () => window.print(),
    // Charter fields
    updCharter: el => {
      const field = el.getAttribute('data-charter-field');
      window.MMGR.Charter.updCharter(field, el.value);
    },
    // Closure fields
    updClose: el => {
      const field = el.getAttribute('data-close-field');
      window.MMGR.Closure.updClose(field, el.value);
    },
    // Hold-to-clear is driven by pointerdown/pointerup delegation below,
    // NOT by click , a plain click must never start the hold countdown.
    // Drag and drop (Kanban)
    dragDrop: el => {
      // Handled by special drag/drop event listeners
    },
    // Hold-to-clear runs on pointerdown delegation (never click), so the
    // click path is an explicit no-op , enforced by the headless audit.
    startHold: () => {}, // pointerdown-only
    // Jump to timeline
    jumpToDashTimeline: () => window.MMGR.App.jumpToDashTimeline(),
    // Generic field update for dynamic render templates (WBS, risks, etc.)
    // evtType ('input' vs 'change') is forwarded so table-rendering updaters
    // can save on keystroke but defer the re-render to blur/commit , a
    // re-render on every keystroke destroys the focused input (browser-verified).
    updTaskField: (el, e) => {
      const id = el.getAttribute('data-id');
      const field = el.getAttribute('data-field');
      window.MMGR.Tasks.updTaskField(id, field, el.value, e && e.type);
    },
    updKPI: el => {
      const idx = parseInt(el.getAttribute('data-idx'));
      const field = el.getAttribute('data-field');
      window.MMGR.Charter.updKPI(idx, field, el.value);
    },
    updKPILink: el =>
      window.MMGR.Charter.updKPILink(parseInt(el.getAttribute('data-idx')), el.value),
    updKPIDir: el => window.MMGR.Charter.updKPIDir(parseInt(el.getAttribute('data-idx')), el.value),
    updRaciTask: el =>
      window.MMGR.Raci.updRaciTask(parseInt(el.getAttribute('data-idx')), el.value),
    updRaciPerson: el =>
      window.MMGR.Raci.updRaciPerson(
        parseInt(el.getAttribute('data-idx')),
        el.getAttribute('data-field'),
        el.value
      ),
    delRaciTask: el => window.MMGR.Raci.delRaciTask(parseInt(el.getAttribute('data-idx'))),
    delRaciPerson: el => window.MMGR.Raci.delRaciPerson(parseInt(el.getAttribute('data-idx'))),
    collapseAll: () => window.MMGR.Tasks.collapseAll(),
    expandAll: () => window.MMGR.Tasks.expandAll(),
    tglMilestone: el => window.MMGR.Tasks.tglMilestone(el.getAttribute('data-id')),
    runMonteCarlo: () => window.MMGR.Schedule.runMonteCarlo(),
    tglDMAICPhase: el => window.MMGR.Dmaic.tglDMAICPhase(el.getAttribute('data-phase')),
    updDMAIC: el =>
      window.MMGR.Dmaic.updDMAIC(
        el.getAttribute('data-phase'),
        el.getAttribute('data-field'),
        el.value
      ),
    uploadCharterDoc: () => window.MMGR.Charter.uploadCharterDoc(),
    handleCharterUpload: el => window.MMGR.Charter.handleCharterUpload({ target: el }),
    cuSwitchTab: el => window.MMGR.Charter.cuSwitchTab(el.getAttribute('data-which')),
    addSpendEntry: () => window.MMGR.Spend.addSpendEntry(),
    updSpendEntry: (el, e) =>
      window.MMGR.Spend.updSpendEntry(
        parseInt(el.getAttribute('data-idx')),
        el.getAttribute('data-field'),
        el.value,
        e && e.type
      ),
    delSpendEntry: el => window.MMGR.Spend.delSpendEntry(parseInt(el.getAttribute('data-idx'))),
    // Meetings
    startMeeting: el => window.MMGR.Meetings.startMeeting(el.getAttribute('data-kind')),
    copyMeetingTemplate: el =>
      window.MMGR.Meetings.copyMeetingTemplate(el.getAttribute('data-kind')),
    openMeetPrompt: () => window.MMGR.Meetings.openMeetPrompt(),
    tglMeetItem: el => window.MMGR.Meetings.tglMeetItem(parseInt(el.getAttribute('data-idx'))),
    updMeetItemNote: el =>
      window.MMGR.Meetings.updMeetItemNote(parseInt(el.getAttribute('data-idx')), el.value),
    updMeetField: el => window.MMGR.Meetings.updMeetField(el.getAttribute('data-field'), el.value),
    endMeeting: () => window.MMGR.Meetings.endMeeting(),
    cancelActiveMeeting: () => window.MMGR.Meetings.cancelActiveMeeting(),
    copyMeetingMinutes: el =>
      window.MMGR.Meetings.copyMeetingMinutes(parseInt(el.getAttribute('data-id'))),
    // T6 (2026-08-16): delete a concluded meeting with undo. MUTATING ,
    // deliberately absent from READONLY_SAFE_ACTIONS (view-only scopes refuse).
    delMeeting: el => window.MMGR.Meetings.delMeeting(parseInt(el.getAttribute('data-id'))),
    undoDelMeeting: () => window.MMGR.Meetings.undoDelMeeting(),
    tglPromise: el =>
      window.MMGR.Meetings.tglPromise(
        el.getAttribute('data-kind'),
        parseInt(el.getAttribute('data-idx'))
      ),
    // Rank 1.5: meeting voice capture (mutates state , NOT in READONLY_SAFE_ACTIONS)
    voiceStartCapture: () => window.MMGR.Voice.startCapture(),
    voiceStopCapture: () => window.MMGR.Voice.stopCapture(),
    voiceDiscardCapture: () => window.MMGR.Voice.discardCapture(false),
    // Tier 1: manual offline whisper transcription / retry (mutates state , blocked in view-only)
    voiceTranscribeOffline: () => window.MMGR.Voice.transcribeOffline(),
    voiceRecoverDismiss: () => window.MMGR.Voice.dismissRecovery(),
    updField: (el, e) => {
      const module = el.getAttribute('data-module');
      const field = el.getAttribute('data-field');
      const idx = parseInt(el.getAttribute('data-idx'));
      const val = el.type === 'checkbox' ? el.checked : el.value;
      // Explicit module → { namespace, updater } map. No string surgery, so
      // a new module can never silently route to the wrong function.
      const MODULE_UPDATERS = {
        Risks: { ns: 'Risks', fn: 'updRisk' },
        Issues: { ns: 'Risks', fn: 'updIssue' }, // Issues live in Risks
        Resources: { ns: 'Resources', fn: 'updResource' },
        Budget: { ns: 'Budget', fn: 'updBudgetLine' },
        Stakeholders: { ns: 'Stakeholders', fn: 'updStake' },
        Changes: { ns: 'Changes', fn: 'updChange' },
        Log: { ns: 'Log', fn: 'updLog' },
        // CloseItems' updater takes (index, done) , no field parameter.
        CloseItems: { ns: 'Closure', fn: 'updCloseItem', doneOnly: true },
        Comms: { ns: 'Comms', fn: 'updComms' },
        Documents: { ns: 'Documents', fn: 'updDoc' },
        // MARKET-FEATURE-ROADMAP C1/C2/C3: RFI + Submittal + Punch List
        // registries (state mutations , never READONLY_SAFE).
        Rfis: { ns: 'Rfis', fn: 'updRfi' },
        Submittals: { ns: 'Submittals', fn: 'updSubmittal' },
        PunchList: { ns: 'PunchList', fn: 'updPunch' },
        // MARKET-FEATURE-ROADMAP Section C batch 2 (state mutations , never
        // READONLY_SAFE).
        PayApps: { ns: 'PayApps', fn: 'updPayApp' },
        Inspections: { ns: 'Inspections', fn: 'updInspection' },
        Incidents: { ns: 'Incidents', fn: 'updIncident' },
        Handover: { ns: 'Handover', fn: 'updHandoverItem' },
        Warranty: { ns: 'Warranty', fn: 'updWarranty' },
        DrawingLog: { ns: 'DrawingLog', fn: 'updDrawLog' },
        Permits: { ns: 'Permits', fn: 'updPermit' },
        Procurement: { ns: 'Procurement', fn: 'updProcurement' },
        TimeTracking: { ns: 'TimeTracking', fn: 'updTimeEntry' },
        Equipment: { ns: 'Equipment', fn: 'updEquipment' }
      };
      const target = MODULE_UPDATERS[module];
      if (!target) {
        console.warn('updField: no updater mapped for module "' + module + '"');
        return;
      }
      const updater = window.MMGR[target.ns] && window.MMGR[target.ns][target.fn];
      if (typeof updater !== 'function') {
        console.warn('updField: ' + target.ns + '.' + target.fn + ' is not a function');
        return;
      }
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
    showSec: 1,
    cpAllPage: 1,
    print: 1,
    openDrw: 1,
    closeDrw: 1,
    // OWNER 2026-09-06: the sign-in sheet is identity UI, never project
    // state - safe in view-only mode (same reasoning as syncConnect).
    openSignIn: 1,
    closeSignIn: 1,
    // T8 bids rebuild: opening a proposal link / composing a clarification
    // email and dismissing the Add Bid Package modal never mutate state.
    bidProposal: 1,
    bidClarify: 1,
    closeBidPkg: 1,
    closeBidPkgBg: 1,
    swDtab: 1,
    openDrwToPrompts: 1,
    openDrwToSave: 1,
    // C23 pool: opening the Library / refreshing the merge mutates NO
    // project state until the user explicitly links a row (poolLinkRow
    // etc. are mutating and stay read-only-blocked for viewers).
    poolOpenLibrary: 1,
    poolCloseLibrary: 1,
    poolRefreshAndMerge: 1,
    jumpToDashTimeline: 1,
    closeMLC: 1,
    openMeetPrompt: 1,
    copyMeetingMinutes: 1,
    runMonteCarlo: 1,
    // PART H: the Procurement disclosure toggle (selVendor) and the quote
    // Copy button are pure view actions; every other proc action mutates
    // state and stays blocked in view-only mode (procQuote also writes
    // aiOutputs, same policy as aiRunPreset).
    selVendor: 1,
    procQuoteCopy: 1,
    // P8 RFQ email pack: the term fields are ephemeral (read live, never
    // state) and the mailto only opens the mail client with text already on
    // screen - both are pure view, safe in view-only mode.
    procQuoteTerm: 1,
    procQuoteMailto: 1,
    // P9: raising a purchase-order PDF is an export (writes only the local
    // PO counter to localStorage, never project state) - safe in view-only.
    procPo: 1,
    // P5 quantity break pricing: opening/closing the tier panel and the live
    // quantity preview are pure view. addTier/delTier/updTier mutate
    // priceTiers and are deliberately NOT listed (view-only refuses them).
    openTiers: 1,
    closeTiers: 1,
    tierPreview: 1,
    // P10: opening/closing the lead-time link card is pure view. The Link
    // button (procLeadLink) writes the task's leadTime + dates and is
    // deliberately NOT listed (view-only refuses it).
    procLead: 1,
    closeLead: 1,
    // P7: dismissing the calculator->RFQ handoff card clears an ephemeral
    // local draft (not project state), so it is safe in view-only mode.
    clearRfq: 1,
    undoClr: 1,
    // MONOLITH-FEATURE-PARITY-DIRECTIVES restorations: risk matrix filtering,
    // WBS issues banner toggle, Import Dates Copy List, email templates, and
    // Print Charter are ALL view-only. saveCharter mutates state and stays
    // blocked in view-only (deliberately not listed here).
    riskMatrixCell: 1,
    riskMatrixClear: 1,
    tglWbsIssues: 1,
    copyIdTemplate: 1,
    emailTpl: 1,
    printCharter: 1,
    // Task 3 AI import: preview, AI read, file load and the file dialog
    // never mutate state (only Fill In does) - safe in view-only mode.
    idReadWithAi: 1,
    idFilePickTrigger: 1,
    idFilePick: 1,
    // Task 6 mailbox: open/close/dismiss are view actions over s.aiInbox;
    // dismiss/clear DO mutate the inbox (local, reversible by the watcher
    // regenerating) - they stay blocked in view-only mode, open/close pass.
    openAiMailbox: 1,
    closeAiMailbox: 1,
    closeAiMailboxBg: 1,
    // Phase 7: wxRefresh (view the forecast) + wxCopyNotice (copy text) are
    // read-only; wxGeocode writes the site location config and wxLogToday /
    // wxLogManual write the LD-claim weather log , all stay blocked in
    // view-only mode. meetSentiment and tglLeadtimeReview mutate state too.
    wxRefresh: 1,
    wxCopyNotice: 1,
    // Rank 3.1: tglPack mutates state.packs -> stays blocked in view-only.
    // Rank 1.1: claimGenerate composes a read-only package; claimSetCause
    // mutates slip tags and stays blocked in view-only mode.
    claimGenerate: 1,
    // Rank 2.1: digestGenerate composes a read-only summary; digestPin writes
    // the reference snapshot and stays blocked in view-only mode.
    digestGenerate: 1,
    // AI window: open/close/load/copy/attach are read-only. Rank 2.3's
    // aiRunPreset/aiRun WRITE state.aiOutputs and aiSet* writes state.config
    // , all correctly stay BLOCKED in view-only mode.
    openAiWin: 1,
    closeAiWin: 1,
    closeAiWinBg: 1,
    aiPreset: 1,
    aiAttachContext: 1,
    aiCopy: 1,
    aiClear: 1,
    aiCopyOut: 1,
    // Rank 1.5: dismissRecovery only hides a local chip (module flag + DOM)
    // , non-mutating, safe in view-only mode. The three capture actions
    // (voiceStartCapture/voiceStopCapture/voiceDiscardCapture) DO mutate
    // state and correctly stay blocked.
    voiceRecoverDismiss: 1,
    // Rank 3.4: viewport preference is a device-level screen choice, not
    // project state , allowed in view-only (like theme is a preference, but
    // this one intentionally stays out of project state entirely).
    vpAccept: 1,
    vpDismiss: 1,
    vpFull: 1,
    // Rank 3.5: glass preference is a device-level screen choice, not
    // project state , allowed in view-only like the viewport prefs.
    tglGlassMode: 1,
    // OWNER 2026-09-06: Performance Mode is a device-level screen choice, not
    // project state , allowed in view-only like glass mode + theme.
    tglPerfMode: 1,
    // The consent toggle is a DEVICE-level choice (localStorage mmgr_consent
    // + the mirror cookie), not project state: it is allowed in view-only
    // mode, exactly like the theme and the glass preference.
    tglConsentStat: 1,
    // M-2 Your data: the export only READS localStorage and downloads a file -
    // no project state changes, so a viewer may take their own copy. The
    // delete button stays out of this list (viewer cannot delete the account).
    exportMyData: 1,
    // Theme-persistence: the theme preference is a device-level choice too
    // (localStorage mmgr_theme, the same slot the launcher + admin read) ,
    // allowed in view-only like glass mode. tglTheme writes only the device
    // pref + body class in view-only; the per-project state write is skipped.
    tglTheme: 1,
    // THEME-SYSTEM-AND-MOBILE-UI-ACTION-PLAN §4.2: the mobile nav drawer is
    // pure device-UI chrome (body.nav-open class only) , never project state.
    // SIDEBAR-HAMBURGER-TOGGLE-PLAN: the sidebar toggle is the same kind of
    // pure device-UI chrome (body.sidebar-on + localStorage pref).
    tglNav: 1,
    tglSidebar: 1,
    tglSidebarOpen: 1,
    bkToggle: 1,
    bkCloud: 1,
    // DIR-1a/1b: copying/downloading the error log is read-only; the
    // remote-reporting toggle + webhook URL are device-level preferences
    // (localStorage, like the glass mode toggle) , never project state.
    copyErrorLog: 1,
    downloadErrorLog: 1,
    tglErrReport: 1,
    setErrWebhook: 1,
    // MASTER-ACTION-PLAN Rank 6.1: building/copying/downloading the report
    // is read-only; the context toggle is a session-only UI pref.
    reportIssueCopy: 1,
    reportIssueDownload: 1,
    tglReportContext: 1,
    // Rank 4.5: Google identity is a device-level label, never a gate to
    // project data , signing in/out/dismissing never mutates project state.
    syncConnect: 1,
    syncSignOut: 1,
    syncClientId: 1,
    syncDismissSuggest: 1,
    // GOOGLE-DRIVE-BACKUP: backup is export-equivalent (reads the workspace,
    // writes Drive + a device pref) and the auto-interval + backup passphrase
    // are device-level preferences (localStorage / sessionStorage, never
    // project state) , safe in view-only, like claimGenerate / digestGenerate
    // / runMonteCarlo above. Restore is DELIBERATELY excluded: it overwrites
    // local workspace, exactly like import, so it stays blocked in view-only.
    driveBackup: 1,
    driveAutoInterval: 1,
    driveSetPass: 1,
    // CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 1: cloud create/save/recover/
    // copy/sign-in never mutate the local workspace (they push to the server
    // or manage session-only credentials) , safe in view-only, exactly like
    // driveBackup above. Load is DELIBERATELY excluded: it overwrites the
    // local workspace like driveRestore/import, so it stays blocked in
    // view-only.
    cloudCreate: 1,
    cloudClaim: 1,
    cloudUpgrade: 1,
    cloudResendVerify: 1,
    cloudSave: 1,
    cloudRecover: 1,
    cloudCopyCode: 1,
    cloudSignIn: 1,
    // SYNC BOND (Task 13): re-sync pulls the cloud snapshot through the
    // per-field merge (newest-wins). A merge CAN overwrite local field
    // values with newer cloud ones - the same honesty contract as
    // cloudLoad/import, which are deliberately excluded here - so
    // cloudResync stays OUT of the view-only safe list (owners/editors
    // only). cloudBondLater is dismiss-only, safe in view-only.
    cloudBondLater: 1,
    // CLOUD-BACKEND-ARCHITECTURE-PLAN Phase 2/3: editor-code management and
    // changelog view/revert never mutate the local workspace (owner-only
    // server calls; a revert changes the CLOUD snapshot, not this device) ,
    // safe in view-only, like the Phase 1 cloud entries above.
    cloudEditorCreate: 1,
    cloudEditorList: 1,
    cloudEditorRevoke: 1,
    cloudClientCreate: 1,
    cloudClientList: 1,
    cloudClientRevoke: 1,
    cloudApiKeyCreate: 1,
    cloudApiKeyList: 1,
    cloudApiKeyRevoke: 1,
    cloudShareTab: 1,
    cloudLogList: 1,
    cloudLogRevert: 1,
    cloudLogToggleDiffs: 1,
    cloudDropEditor: 1,
    // GAP-AUDIT-CLOUD-31: unlink only mutates the CLOUD copy (like the other
    // cloud actions above), and the banner Copy/Done are clipboard/session
    // only , all safe in view-only.
    cloudUnlink: 1,
    cloudCopyEditorCode: 1,
    cloudEditorCodeDone: 1,
    // MASTER-ACTION-PLAN RANK 9.2: webhook CRUD only mutates the SERVER
    // subscription table (like the other cloud actions) , safe in view-only.
    cloudWebhookList: 1,
    cloudWebhookAdd: 1,
    cloudWebhookDel: 1,
    // CLOUD-FIRST SYNC (PART 3, approved 2026-08-17): offline copies +
    // broadcast. cloudMakeCopy registers this device server-side (view-only
    // by owner decision , the copy can never edit), cloudUpdateCopy pulls the
    // newest snapshot into the copy (overwriting a VIEW-ONLY snapshot is
    // always safe , no local edits exist to lose), cloudRemoveCopy
    // unregisters, and the owner's broadcast/auto-broadcast/offline-list
    // controls only mutate SERVER state or the copy registry , all safe in
    // view-only mode, exactly like the other cloud actions above.
    cloudMakeCopy: 1,
    cloudUpdateCopy: 1,
    cloudRemoveCopy: 1,
    cloudBroadcast: 1,
    cloudAutoBroadcast: 1,
    cloudOfflineRemove: 1,
    // REVIEW QUEUE: the review list/accept/reject/mine actions only mutate
    // SERVER state (proposals + the cloud snapshot on accept) , never the
    // local workspace , so they stay safe in view-only mode like broadcast.
    cloudReviewList: 1,
    cloudReviewMine: 1,
    cloudReviewAccept: 1,
    cloudReviewReject: 1,
    cloudReviewToggleDiffs: 1
  };
  function guardReadonly(action) {
    // The ACTION_MAP delegation IIFE has no closure over the App module's
    // isReadonly() , route through the published API (MMGR.App.isReadonly).
    const ro =
      window.MMGR.App &&
      typeof window.MMGR.App.isReadonly === 'function' &&
      window.MMGR.App.isReadonly();
    if (!ro) {
      return true;
    }
    if (READONLY_SAFE_ACTIONS[action]) {
      return true;
    }
    if (window.MMGR.App && typeof window.MMGR.App.showToast === 'function') {
      window.MMGR.App.showToast(
        'View-only mode , read-only access. Contact the admin for full access.',
        'err'
      );
    }
    return false;
  }

  // Click event delegation
  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) {
      return;
    }
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
    if (
      _tag === 'SELECT' ||
      _tag === 'TEXTAREA' ||
      (_tag === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'button')
    ) {
      return;
    }
    const action = el.getAttribute('data-action');
    if (!guardReadonly(action)) {
      // View-only rejection: Chrome has already flipped a checkbox's `checked`
      // before this handler runs, so revert it , otherwise the switch would
      // visually toggle while the state it controls stays unchanged (audit
      // 1.2 / 1.3 , the AI master switch, tglPack, tglFlag all behave this way).
      if (el.tagName === 'INPUT' && el.type === 'checkbox') {
        el.checked = !el.checked;
      }
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
  document.addEventListener('change', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) {
      return;
    }
    const action = el.getAttribute('data-action');
    if (!guardReadonly(action)) {
      return;
    }
    const handler = ACTION_MAP[action];
    // CLAUDE-BUG-AUDIT (2026-08-11) #1: syncClientId is a type-then-blur text
    // field (Google OAuth Client ID) , it was missing from this change
    // whitelist, so the value sat in the box but was never persisted.
    // `change` is the correct event for a one-time paste/type-then-blur field.
    if (
      handler &&
      (action === 'updEnvelope' ||
        action === 'saveSprint' ||
        action === 'setWorkWeek' ||
        action === 'setRegion' ||
        action === 'setDeadline' ||
        action === 'loadProjectFile' ||
        action === 'mergeProjectFile' ||
        action === 'updCharter' ||
        action === 'updClose' ||
        action === 'setUserName' ||
        action === 'addRaciTaskFromPicker' ||
        action === 'addRaciPersonFromPicker' ||
        action === 'updField' ||
        action === 'updTaskField' ||
        action === 'updKPI' ||
        action === 'updKPILink' ||
        action === 'updKPIDir' ||
        action === 'updSpendEntry' ||
        action === 'updRaciTask' ||
        action === 'updRaciPerson' ||
        action === 'claimSetCause' ||
        action === 'aiSetTier' ||
        action === 'setErrWebhook' ||
        action === 'driveAutoInterval' ||
        action === 'driveSetPass' ||
        action === 'syncClientId' ||
        action === 'bidPkgUpd' ||
        action === 'bidSubUpd' ||
        action === 'bidLineUpd' ||
        action === 'bidAmount' ||
        action === 'gonogoUpd' ||
        action === 'gonogoCatUpd' ||
        action === 'gonogoCritUpd' ||
        action === 'updInspItem' ||
        action === 'updPvendor' ||
        action === 'updPitem' ||
        action === 'updTier' ||
        action === 'procQuoteVendor' ||
        action === 'procQuoteTone' ||
        action === 'procQuoteTerm' ||
        action === 'idFilePick')
    ) {
      handler(el, e);
    }
  });

  // Rank 3.1: tglPack chips are checkboxes , the click delegation handles
  // them (checkbox click IS the action), and the action map entry above flips
  // state.packs. No change/input whitelist entry needed.

  // Input event delegation for textarea/input elements
  document.addEventListener('input', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) {
      return;
    }
    const action = el.getAttribute('data-action');
    if (!guardReadonly(action)) {
      return;
    }
    const handler = ACTION_MAP[action];
    if (
      handler &&
      (action === 'updCharter' ||
        action === 'updClose' ||
        action === 'setUserName' ||
        action === 'updEnvelope' ||
        action === 'wiPreview' ||
        action === 'idPreview' ||
        action === 'regenChartPrompt' ||
        action === 'updField' ||
        action === 'updTaskField' ||
        action === 'updKPI' ||
        action === 'updSpendEntry' ||
        action === 'updRaciTask' ||
        action === 'updRaciPerson' ||
        action === 'updDMAIC' ||
        action === 'updMeetItemNote' ||
        action === 'updMeetField' ||
        action === 'handleCharterUpload' ||
        action === 'setErrWebhook' ||
        action === 'bidPkgUpd' ||
        action === 'bidSubUpd' ||
        action === 'bidLineUpd' ||
        action === 'bidAmount' ||
        action === 'gonogoUpd' ||
        action === 'gonogoCatUpd' ||
        action === 'gonogoCritUpd' ||
        action === 'updInspItem' ||
        action === 'updPvendor' ||
        action === 'updPitem' ||
        action === 'updTier')
    ) {
      handler(el, e);
    }
  });

  // 5.2 Definitions tooltips: any element with data-def="<term>" shows the
  // glossary entry on hover. Delegated mouseover/out , zero inline handlers.
  document.addEventListener('mouseover', function (e) {
    const el = e.target.closest && e.target.closest('[data-def]');
    if (el) {
      window.MMGR.App.showDefTip(el, el.getAttribute('data-def'));
    }
  });
  document.addEventListener('mouseout', function (e) {
    const el = e.target.closest && e.target.closest('[data-def]');
    if (el) {
      window.MMGR.App.hideDefTip();
    }
  });

  // RACI right-click cycles backward (feature 5) , contextmenu must be
  // prevented so the browser's menu never appears over the matrix.
  document.addEventListener('contextmenu', function (e) {
    const cell = e.target.closest && e.target.closest('[data-action="cycleRaci"]');
    if (cell) {
      e.preventDefault();
      window.MMGR.Raci.cycleRaci(cell.getAttribute('data-task'), cell.getAttribute('data-person'), {
        button: 2
      });
    }
  });

  // RACI picker refresh on mousedown
  document.addEventListener('mousedown', function (e) {
    const el = e.target.closest(
      '[data-action="addRaciTaskFromPicker"], [data-action="addRaciPersonFromPicker"]'
    );
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
  document.addEventListener(
    'mouseenter',
    function (e) {
      const el = e.target && e.target.closest ? e.target.closest('[data-mlc]') : null;
      if (el) {
        window.MMGR.App.showMLC(el.getAttribute('data-mlc'));
      }
    },
    true
  );

  document.addEventListener(
    'mouseleave',
    function (e) {
      const el = e.target && e.target.closest ? e.target.closest('[data-mlc]') : null;
      if (el) {
        window.MMGR.App.scheduleMLCClose();
      }
    },
    true
  );

  // MLC card hover , keep open
  document.addEventListener(
    'mouseenter',
    function (e) {
      if (e.target && e.target.closest && e.target.closest('#meth-learn-card')) {
        window.MMGR.App.clearMlcTimer();
      }
    },
    true
  );

  document.addEventListener(
    'mouseleave',
    function (e) {
      if (e.target && e.target.closest && e.target.closest('#meth-learn-card')) {
        window.MMGR.App.scheduleMLCClose();
      }
    },
    true
  );

  // Kanban drag and drop
  document.addEventListener('dragstart', function (e) {
    const el = e.target.closest('[data-drag-id]');
    if (el) {
      window.MMGR.App.dragCard(e, el.getAttribute('data-drag-id'));
      // OWNER 2026-09-28 (kanban drop-targets): while a card is airborne,
      // light up every drop destination on the board and lift the dragged
      // card. dragend (fires even on cancelled drops) cleans up.
      const board = document.querySelector('.kb');
      if (board) {
        board.classList.add('is-dragging');
        el.classList.add('drag');
      }
    }
  });

  document.addEventListener('dragend', function (e) {
    window.MMGR.App.endBoardDrag();
    const el = e.target && e.target.closest ? e.target.closest('[data-drag-id]') : null;
    if (el) {
      el.classList.remove('drag');
    }
  });

  document.addEventListener('dragover', function (e) {
    const col = e.target.closest('[data-drop-status]');
    if (col) {
      e.preventDefault();
      col.classList.add('dov');
    }
  });

  document.addEventListener('dragleave', function (e) {
    const col = e.target.closest('[data-drop-status]');
    if (col) {
      col.classList.remove('dov');
    }
  });

  document.addEventListener('drop', function (e) {
    const col = e.target.closest('[data-drop-status]');
    if (!col) {
      return;
    }
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
  // VIEW-ONLY HARDENING (owner 2026-09-12): startHold runs on pointerdown,
  // NOT the guarded click delegation, and after a 10s hold it DELETES the
  // whole section (clearSection) - a viewer could wipe the WBS. Refuse it.
  document.addEventListener('pointerdown', function (e) {
    const el = e.target.closest('[data-action="startHold"]');
    if (!el) {
      return;
    }
    if (window.MMGR.App && window.MMGR.App.isReadonly && window.MMGR.App.isReadonly()) {
      e.preventDefault();
      window.MMGR.App.showToast('View-only access: nothing can be cleared.', 'err');
      return;
    }
    window.MMGR.App.startHold(el.getAttribute('data-section'));
  });

  // Release anywhere cancels , cancelHold is a no-op when nothing is held,
  // so no closest() gating is needed (and it covers releases over other
  // elements, re-rendered buttons, and pointer-capture edge cases).
  document.addEventListener('pointerup', () => window.MMGR.App.cancelHold());

  // HOLD-TO-DELETE (owner 2026-09-17): the danger-zone Delete project button
  // needs a 10-second press-and-hold before cloudDeleteConfirm runs. Same
  // contract as hold-to-clear: start on pointerdown, cancel on release /
  // pointercancel / leaving the button / blur. View-only scopes refuse with
  // a toast (the danger zone is owner-only UI, but the gate is the proof).
  document.addEventListener('pointerdown', function (e) {
    const el = e.target.closest && e.target.closest('[data-action="cloudDeleteConfirm"]');
    if (!el) {
      return;
    }
    e.preventDefault();
    if (window.MMGR.App && window.MMGR.App.isReadonly && window.MMGR.App.isReadonly()) {
      window.MMGR.App.showToast('View-only access: nothing can be deleted.', 'err');
      return;
    }
    const C = window.MMGR.Cloud;
    if (C && C.cloudDeleteHoldBegin) {
      C.cloudDeleteHoldBegin();
    }
  });
  document.addEventListener('pointerup', function () {
    const C = window.MMGR.Cloud;
    if (C && C.cloudDeleteHoldCancel) {
      C.cloudDeleteHoldCancel();
    }
  });
  document.addEventListener('pointercancel', function () {
    const C = window.MMGR.Cloud;
    if (C && C.cloudDeleteHoldCancel) {
      C.cloudDeleteHoldCancel();
    }
  });
  document.addEventListener(
    'mouseleave',
    function (e) {
      if (e.target.closest && e.target.closest('[data-action="cloudDeleteConfirm"]')) {
        const C = window.MMGR.Cloud;
        if (C && C.cloudDeleteHoldCancel) {
          C.cloudDeleteHoldCancel();
        }
      }
    },
    true
  );
  window.addEventListener('blur', function () {
    const C = window.MMGR.Cloud;
    if (C && C.cloudDeleteHoldCancel) {
      C.cloudDeleteHoldCancel();
    }
  });
  // Keyboard parity: hold Space (or Enter) on the focused button, exactly
  // like a pointer hold; releasing the key cancels.
  document.addEventListener('keydown', function (e) {
    if (e.key !== ' ' && e.key !== 'Enter') {
      return;
    }
    const el =
      document.activeElement && document.activeElement.closest
        ? document.activeElement.closest('[data-action="cloudDeleteConfirm"]')
        : null;
    if (!el || e.repeat) {
      return;
    }
    if (window.MMGR.App && window.MMGR.App.isReadonly && window.MMGR.App.isReadonly()) {
      return;
    }
    const C = window.MMGR.Cloud;
    if (C && C.cloudDeleteHoldBegin) {
      e.preventDefault();
      C.cloudDeleteHoldBegin();
    }
  });
  document.addEventListener('keyup', function (e) {
    if (e.key !== ' ' && e.key !== 'Enter') {
      return;
    }
    const C = window.MMGR.Cloud;
    if (C && C.cloudDeleteHoldCancel) {
      C.cloudDeleteHoldCancel();
    }
  });

  document.addEventListener('pointercancel', () => window.MMGR.App.cancelHold());

  document.addEventListener(
    'mouseleave',
    function (e) {
      if (e.target.closest && e.target.closest('[data-action="startHold"]')) {
        window.MMGR.App.cancelHold();
      }
    },
    true
  );

  window.addEventListener('blur', () => window.MMGR.App.cancelHold());
})();
