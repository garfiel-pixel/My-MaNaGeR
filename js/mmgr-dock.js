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
  }

  function boot() {
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

  // Auto-boot the premium glass engine on pages whose inline boot sync runs
  // before their deferred bundle defines MMGR (launcher + admin — the inline
  // IIFEs at the end of app.html/admin.html are parse-time, so this is the
  // only post-bundle hook those pages have; project.html boots it itself).
  // sync() is idempotent: it only activates when the engine is inactive.
  try {
    if (window.MMGR && window.MMGR.Glass && window.MMGR.Glass.sync) window.MMGR.Glass.sync();
  } catch (e) { /* glass boot must never break the page */ }
})();