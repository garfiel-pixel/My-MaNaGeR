/* ============================================================
   My MaNaGeR , Device Theme Helper (Light / Dark / System)
   ------------------------------------------------------------
   Single early-load helper shared by EVERY page (app, project,
   admin, launcher, and marketing pages). Applies the saved
   theme before first paint. External file on purpose - covered
   by CSP script-src 'self' with zero inline-hash churn.

   One axis: appearance mode
     'light'  - warm gold accent on clean light interface
     'dark'   - muted gold accent on professional dark interface
     'system' - follow OS prefers-color-scheme (restored 2026-09-03, owner D6)

   Storage key: mmgr_theme = 'light' | 'dark' | 'system'
   (backward-compatible: existing 'dark'/'light' values work;
    old 'mmgr_palette' key is retired.)

   Default: LIGHT for new visitors (owner D12, 2026-09-03) - a fresh
   browser with no mmgr_theme stays light until the user picks a mode.
   Restoring 'system' does NOT restore System as the default.

   CSS mechanics:
     - body.dark-mode is toggled when effective mode is dark
     - :root in mmgr.css defines light tokens
     - body.dark-mode in mmgr.css overrides with dark tokens
     - No palette switching - one brand, two appearances

   Persistence:
     1. Backend (app pages with data-sync="1") when available
     2. localStorage cache - instant, works offline
     3. Default - light (D12)

   NO-EMOJI HARD GATE (owner 2026-08-13): zero emoji in any
   served page or JS string that renders into a page. Theme
   picker uses SVG icons only.
   ============================================================ */
(function () {
  'use strict';

  var MODE_KEY = 'mmgr_theme';       // 'light' | 'dark' | 'system'
  var BACK_KEY = 'mmgr_theme_backend'; // '1' after a successful backend round-trip
  var KNOWN = { 'light': 1, 'dark': 1, 'system': 1 };

  // data-sync="1" on the <script> tag enables the backend path.
  var SYNC = !!(document.currentScript && document.currentScript.getAttribute('data-sync') === '1');

  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function write(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /** Current stored mode (default: light - D12). */
  function currentMode() {
    var v = read(MODE_KEY);
    // No default-to-system here: a fresh browser (or a cleared pref) stays
    // light until the user explicitly picks Light / Dark / System (D12).
    return KNOWN[v] ? v : 'light';
  }

  /** Whether OS dark preference is active. */
  function osDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  /** Effective dark state: dark when mode=dark, or mode=system + OS dark. */
  function isDark() {
    var m = currentMode();
    return m === 'dark' || (m === 'system' && osDark());
  }

  /** Sync <meta name="theme-color"> to the browser chrome bar. */
  function syncThemeColor(dark) {
    var c = dark ? '#1a1614' : '#F5EFE6';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
    meta.setAttribute('content', c);
  }

  /**
   * Apply the current theme mode.
   * Sets body.dark-mode class + updates picker aria states + syncs glass.
   */
  function apply() {
    var dark = isDark();
    var mode = currentMode();
    if (document.body) {
      document.body.classList.toggle('dark-mode', dark);
    }
    // Update all theme-mode picker buttons on the page.
    var btns = document.querySelectorAll('.pal-btn[data-pal]');
    for (var i = 0; i < btns.length; i++) {
      var match = btns[i].getAttribute('data-pal') === mode;
      btns[i].setAttribute('aria-pressed', match ? 'true' : 'false');
    }
    syncThemeColor(dark);
    return mode;
  }

  /** Push current mode to the cloud backend (app pages only). */
  function pushBackend() {
    if (!SYNC) return;
    try {
      fetch('/api/cloud/prefs/theme', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ palette: 'default', dark: isDark() })
      }).then(function (r) {
        if (r.ok) write(BACK_KEY, '1');
      }).catch(function () {});
    } catch (e) {}
  }

  /** Pull saved mode from the cloud backend (app pages only). */
  function pullBackend() {
    if (!SYNC) return;
    if (_userTouched) return;
    try {
      fetch('/api/cloud/prefs/theme', { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.ok || !d.theme) return;
          if (_userTouched) return;
          // A System user must keep following the OS - the backend only
          // stores the effective dark boolean, so don't let a stale pull
          // overwrite the explicit 'system' choice (restored 2026-09-03).
          if (currentMode() === 'system') return;
          // Backend may still send old palette format - map to mode.
          var dark = !!d.theme.dark;
          var mode = dark ? 'dark' : 'light';
          write(MODE_KEY, mode);
          write(BACK_KEY, '1');
          apply();
          syncGlass();
        }).catch(function () {});
    } catch (e) {}
  }

  var _userTouched = false;

  /** Keep premium-glass shader in step. */
  function syncGlass() {
    var G = window.MMGR && window.MMGR.Glass;
    if (G && G.refreshTheme) G.refreshTheme();
  }

  /**
   * Set the theme mode and persist it.
   * @param {string} mode - 'light' | 'dark' | 'system'
   */
  function setMode(mode) {
    mode = KNOWN[mode] ? mode : 'light'; // D12: never silently follow OS
    _userTouched = true;
    write(MODE_KEY, mode);
    apply();
    syncGlass();
    pushBackend();
  }

  /** Listen for OS preference changes when mode is 'system'. */
  function watchSystemPreference() {
    if (!window.matchMedia) return;
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var handler = function () {
      if (currentMode() === 'system') apply();
    };
    if (mq.addEventListener) { mq.addEventListener('change', handler); }
    else if (mq.addListener) { mq.addListener(handler); }
  }

  // --- Event delegation: one listener serves every picker on the page ---
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-pal]') : null;
    if (!b) return;
    e.preventDefault();
    setMode(b.getAttribute('data-pal'));
  });

  // --- Boot ---
  apply();
  // On pages where the script loads in <head>, body doesn't exist yet.
  // Re-apply once DOM is ready so body.dark-mode engages on marketing pages.
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', function () {
      apply();
      watchSystemPreference();
    });
  } else {
    watchSystemPreference();
  }
  // Pull from backend once per load (if previously synced).
  if (read(BACK_KEY) === '1') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', pullBackend);
    } else {
      pullBackend();
    }
  }

  // --- Public API ---
  window.MMGRTheme = {
    getMode: currentMode,
    setMode: setMode,
    isDark: isDark,
    apply: apply
  };
})();
