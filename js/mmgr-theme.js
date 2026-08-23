/* ============================================================
   My MaNaGeR , Device Theme Helper (palette + dark)
   ------------------------------------------------------------
   THEME-SYSTEM-AND-MOBILE-UI-ACTION-PLAN §2.3/§4.1 (2026-08-11)

   Single early-load helper shared by EVERY page (app, project, admin,
   launcher, and the four marketing pages). It applies the saved theme
   before first paint , external file on purpose, so it is covered by the
   CSP script-src 'self' policy with zero inline-hash churn.

   Two independent axes:
     - palette  : 'default' (current gold system) | 'cyan' (fluorescent blue)
                  -> <html data-theme="...">   (storage key: mmgr_palette)
     - dark     : body.dark-mode               (storage key: mmgr_theme,
                  existing device slot, values 'dark' | 'light' , UNCHANGED
                  contract; the plan's "mmgr_theme = palette" naming would
                  have clobbered the shipped dark toggle, so the palette
                  lives in its own slot).

   Persistence order (plan §2.3):
     1. Backend , PUT /api/cloud/prefs/theme (session-gated, R2-backed)
        whenever the user picks a palette on an app page (script tag
        carries data-sync="1"); GET is pulled once per load once a device
        has synced (mmgr_palette_backend flag) so the signed-in account's
        preference follows the user across devices.
     2. localStorage , mmgr_palette / mmgr_theme cache; applies instantly,
        works offline.
     3. Default , 'default' + light.

   FUTURE THEME RECIPE (plan §8): add a 'name' to KNOWN below, a matching
   [data-theme="name"] CSS block in mmgr.css + marketing.css, a
   <button data-pal="name"> in the pickers, and accept the string in the
   worker endpoint. No other code changes.
   ============================================================ */
(function () {
  'use strict';

  var PAL_KEY = 'mmgr_palette';         // 'default' | 'cyan' (palette slot)
  var DARK_KEY = 'mmgr_theme';          // 'dark' | 'light' (existing slot)
  var BACK_FLAG_KEY = 'mmgr_palette_backend'; // '1' after a successful backend round-trip
  var KNOWN = { 'default': true, 'cyan': true };

  // data-sync="1" on the <script> tag enables the backend path (app pages).
  var SYNC = !!(document.currentScript && document.currentScript.getAttribute('data-sync') === '1');

  function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function write(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }

  function currentPalette() {
    var v = read(PAL_KEY);
    return KNOWN[v] ? v : 'default';
  }
  function isDark() { return read(DARK_KEY) === 'dark'; }

  // theme-color sync per palette/dark (browser chrome bar; plan Phase D).
  var THEME_COLORS = {
    'default': { light: '#D4AF37', dark: '#090a0f' },
    'cyan':    { light: '#0f766e', dark: '#001619' }
  };
  function syncThemeColor(pal, dark) {
    var c = (THEME_COLORS[pal] || THEME_COLORS['default'])[dark ? 'dark' : 'light'];
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', c);
  }

  // Reflect the palette onto the root element + every picker on the page.
  function apply(pal, opts) {
    opts = opts || {};
    pal = KNOWN[pal] ? pal : 'default';
    var root = document.documentElement;
    if (root) root.setAttribute('data-theme', pal);
    if (opts.dark !== undefined && document.body) {
      document.body.classList.toggle('dark-mode', !!opts.dark);
    }
    var btns = document.querySelectorAll('.pal-btn[data-pal]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', btns[i].getAttribute('data-pal') === pal ? 'true' : 'false');
    }
    syncThemeColor(pal, opts.dark !== undefined ? !!opts.dark : isDark());
    return pal;
  }

  function pushBackend(pal) {
    if (!SYNC) return;
    try {
      fetch('/api/cloud/prefs/theme', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ palette: pal, dark: isDark() })
      }).then(function (r) {
        if (r.ok) write(BACK_FLAG_KEY, '1');
      }).catch(function () { /* offline / no worker , localStorage remains the cache */ });
    } catch (e) { /* ignore */ }
  }

  function pullBackend() {
    if (!SYNC) return;
    // RACE GUARD: if the user picked a palette in this session before the GET
    // resolved, the stored backend value is stale relative to their choice , 
    // skip the pull entirely (their pick will be pushed by setPalette and wins).
    if (_userTouched) return;
    try {
      fetch('/api/cloud/prefs/theme', { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.ok || !d.theme) return;
          if (_userTouched) return; // user picked mid-flight , their choice wins
          var pal = KNOWN[d.theme.palette] ? d.theme.palette : null;
          if (pal === null && typeof d.theme.dark !== 'boolean') return;
          if (pal !== null) write(PAL_KEY, pal);
          write(DARK_KEY, d.theme.dark ? 'dark' : 'light');
          write(BACK_FLAG_KEY, '1');
          apply(pal === null ? currentPalette() : pal, { dark: !!d.theme.dark });
          syncGlass();
        }).catch(function () { /* backend unreachable , keep local cache */ });
    } catch (e) { /* ignore */ }
  }

  // The user made a choice in THIS session , the backend pull must never
  // clobber it (a stale GET could resolve after a fresh click and overwrite
  // the pick; see pullBackend's guard below).
  var _userTouched = false;

  // Keep the premium-glass shader in step with palette changes (it has its own
  // uCyan uniform, refreshed via MMGR.Glass.refreshTheme , the dark toggle in
  // mmgr-app.js already refreshes it on light/dark flips).
  function syncGlass() {
    // Glass.refreshTheme is internally guarded (_state.active && _state.uniforms)
    // and existence-checked here, so there is no throw path.
    var G = window.MMGR && window.MMGR.Glass;
    if (G && G.refreshTheme) G.refreshTheme();
  }

  function setPalette(pal) {
    pal = KNOWN[pal] ? pal : 'default';
    _userTouched = true;
    write(PAL_KEY, pal);
    apply(pal, { dark: isDark() });
    syncGlass();
    pushBackend(pal);
    return pal;
  }

  // One delegated listener serves every picker on the page (no inline JS,
  // no CSP hash churn , the buttons carry data-pal, not data-action).
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-pal]') : null;
    if (!b) return;
    e.preventDefault();
    setPalette(b.getAttribute('data-pal'));
  });

  // Boot: apply the saved theme instantly (pre-paint), then let the backend
  // override once per load on devices that have synced before. On pages that
  // load this helper in <head> (the four marketing pages) document.body does
  // not exist yet, so the dark-mode class is applied again once the DOM is
  // ready , otherwise body.dark-mode would never engage there.
  apply(currentPalette(), { dark: isDark() });
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', function () {
      apply(currentPalette(), { dark: isDark() });
    });
  }
  if (read(BACK_FLAG_KEY) === '1') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', pullBackend);
    } else {
      pullBackend();
    }
  }

  window.MMGRTheme = {
    get: currentPalette,
    set: setPalette,
    isDark: isDark,
    apply: apply
  };
})();
