/* ============================================================
   My MaNaGeR — Shared Bottom Dock (owner D3/D6/D11, 2026-09-03)
   ------------------------------------------------------------
   The canonical appearance controls on every app page (launcher,
   project, admin): the vertical Light/Dark/System theme stack
   (data-pal rides the mmgr-theme.js delegated listener) plus the
   premium-glass toggle (data-action=tglGlassMode rides each page's
   action map). This file ONLY keeps the dock in step with every
   other theme/glass control on the page (rail toggles, the header
   moon quick-toggle, gate controls) and with the stored
   preferences, so one picker never drifts.

   External on purpose: CSP script-src 'self', zero hash churn.
   Deferred after the page bundle so MMGR.Viewport exists; falls
   back to DOMContentLoaded when the bundle is missing (dev mode,
   where the individual source files are injected then).

   No-emoji hard gate: icons are SVG sprite refs only.
   ============================================================ */
(function () {
  'use strict';

  /** Re-sync the dock with the page's current effective preferences.
   *
   *  IMPORTANT: this syncs only the dock's OWN control states (aria-pressed
   *  on the theme buttons, checked on the glass switch). It deliberately
   *  does NOT re-apply body.dark-mode — the FOUC script, mmgr-theme.js and
   *  the app boot already own the body class (the boot also reconciles the
   *  per-project state.theme fallback, which a blind apply() would fight;
   *  see mmgr-app.js boot).
   */
  function sync() {
    // Glass toggles: reflect Viewport's effective mode (premium vs CSS) on
    // EVERY tglGlassMode instance (dock + rail + gate), so the whole page
    // stays in step with the engine's actual state.
    try {
      var G = window.MMGR && window.MMGR.Viewport
        ? window.MMGR.Viewport.getGlassMode()
        : 'css';
      var gs = document.querySelectorAll('[data-action="tglGlassMode"]');
      for (var i = 0; i < gs.length; i++) gs[i].checked = (G === 'premium');
    } catch (e) { /* Viewport not ready yet — next sync will catch it */ }
    // Theme stack: set the dock's own .pal-btn aria-pressed from the stored
    // mode (MMGRTheme.getMode is the single source of truth; light default
    // per owner D12).
    try {
      var mode = window.MMGRTheme && window.MMGRTheme.getMode ? window.MMGRTheme.getMode() : null;
      if (mode) {
        var btns = document.querySelectorAll('.dock .pal-btn[data-pal]');
        for (var i = 0; i < btns.length; i++) {
          btns[i].setAttribute('aria-pressed', btns[i].getAttribute('data-pal') === mode ? 'true' : 'false');
        }
      }
    } catch (e) {}
    // Palette + View rows (Phase 3, owner D7/D9): aria-pressed mirrors the
    // EFFECTIVE preference (a stored '3d' shows pressed even when narrow /
    // reduced-motion currently forces flat — the press state says what is
    // selected, not what is physically rendered).
    try {
      var pal = effectivePalette();
      var pbtns = document.querySelectorAll('.dock .pal-btn[data-palette]');
      for (var j = 0; j < pbtns.length; j++) {
        pbtns[j].setAttribute('aria-pressed', pbtns[j].getAttribute('data-palette') === pal ? 'true' : 'false');
      }
      var view = readPref(VIEW_KEY, 'flat');
      var vbtns = document.querySelectorAll('.dock .pal-btn[data-view]');
      for (var k = 0; k < vbtns.length; k++) {
        vbtns[k].setAttribute('aria-pressed', vbtns[k].getAttribute('data-view') === view ? 'true' : 'false');
      }
    } catch (e) {}
  }

  // ---- Phase 3: palette (Gold/Rose) + view (Flat/3D) axes ----
  // Two independent persisted prefs, both defaulting to the shipped look:
  //   mmgr_palette    'gold' | 'rose'  -> html[data-theme="rose-gold"]
  //   mmgr_view_mode  'flat' | '3d'    -> body.view-3d (effective only when
  //                                       wide + motion allowed; mobile and
  //                                       reduced-motion auto-flat per E3/E5).
  var PAL_KEY = 'mmgr_palette';
  var VIEW_KEY = 'mmgr_view_mode';
  function readPref(k, fb) {
    try { return localStorage.getItem(k) || fb; } catch (e) { return fb; }
  }
  function effectivePalette() {
    return readPref(PAL_KEY, 'gold') === 'rose' ? 'rose' : 'gold';
  }
  function viewAllowed() {
    try {
      var V = window.MMGR && window.MMGR.Viewport ? window.MMGR.Viewport : null;
      if (V && typeof V.isNarrow === 'function' && V.isNarrow()) return false;
    } catch (e) { /* Viewport not ready yet — width check below covers it */ }
    if (window.innerWidth < 769) return false; // repo desktop boundary (769px)
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    return true;
  }
  function applyPalette(p) {
    var rose = (p === 'rose');
    try { localStorage.setItem(PAL_KEY, rose ? 'rose' : 'gold'); } catch (e) {}
    var docEl = document.documentElement;
    if (rose) { docEl.setAttribute('data-theme', 'rose-gold'); }
    else { docEl.removeAttribute('data-theme'); }
    // Premium glass colorway follows the palette (uRose reads data-theme).
    try {
      var G = window.MMGR && window.MMGR.Glass ? window.MMGR.Glass : null;
      if (G && G.refreshTheme) G.refreshTheme();
    } catch (e) {}
    sync();
  }
  function applyView() {
    var want = readPref(VIEW_KEY, 'flat');
    var on = want === '3d' && viewAllowed();
    document.body.classList.toggle('view-3d', on);
    sync();
  }
  function chooseView(m) {
    try { localStorage.setItem(VIEW_KEY, m === '3d' ? '3d' : 'flat'); } catch (e) {}
    applyView();
  }
  var _rzT = null;
  function onViewportChange() {
    if (_rzT) clearTimeout(_rzT);
    _rzT = setTimeout(function () { applyView(); }, 150); // debounce resize/orientation
  }

  function boot() {
    applyPalette(effectivePalette());
    applyView();
    sync();
    // Re-sync after any other theme/glass control fires (rail toggles,
    // header moon quick-toggle, tglTheme checkboxes) so the dock's pressed /
    // checked state never drifts from the page.
    document.addEventListener('click', function (e) {
      var n = e.target;
      if (!n || !n.closest) return;
      if (n.closest('[data-pal],[data-action="tglTheme"],[data-action="tglThemeQuick"],[data-action="tglGlassMode"]')) {
        setTimeout(sync, 0);
      }
    });
  }

  if (window.MMGR && window.MMGR.Viewport) {
    boot();
  } else {
    // Bundle absent (local dev fallback injects the source files at
    // DOMContentLoaded, before this listener runs).
    document.addEventListener('DOMContentLoaded', boot);
  }

  // Palette + View are dock-owned axes (no page action map needed): one
  // delegated listener serves every page. data-pal (theme) keeps riding the
  // mmgr-theme.js listener, untouched.
  document.addEventListener('click', function (e) {
    var n = e.target && e.target.closest ? e.target.closest('[data-palette],[data-view]') : null;
    if (!n) return;
    e.preventDefault();
    if (n.hasAttribute('data-palette')) applyPalette(n.getAttribute('data-palette'));
    if (n.hasAttribute('data-view')) chooseView(n.getAttribute('data-view'));
  });
  // Mobile auto-flat + rotate: re-evaluate the effective view on resize /
  // orientation changes (a phone rotated wide still respects the narrow rule;
  // a window widened past 769 re-enables a stored 3D choice).
  window.addEventListener('resize', onViewportChange);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onViewportChange);

  // Auto-boot the premium glass engine on pages whose inline boot sync runs
  // before their deferred bundle defines MMGR (launcher + admin — the inline
  // IIFEs at the end of app.html/admin.html are parse-time, so this is the
  // only post-bundle hook those pages have; project.html boots it itself).
  // sync() is idempotent: it only activates when the engine is inactive.
  try {
    if (window.MMGR && window.MMGR.Glass && window.MMGR.Glass.sync) window.MMGR.Glass.sync();
  } catch (e) { /* glass boot must never break the page */ }
})();