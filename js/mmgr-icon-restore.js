/* ============================================================
   My MaNaGeR - Sprite icon restore after bfcache restores
   ------------------------------------------------------------
   Owner-reported bug (2026-09-30): app.html -> calculator.html
   -> Back leaves app icons unpainted. Proven by probe: the
   return navigation restores from Chrome's back/forward cache
   (pageshow.persisted === true), and on such restores
   <use href="css/mmgr-icons.svg#i-..."> references lose their
   rendered shadow content - the svg hosts keep their CSS size
   but draw nothing.
   Fix: on a persisted pageshow, force every external-sprite
   <use> to re-resolve its reference (clear href, reflow,
   restore). Idempotent, offline-first (touches no network),
   no inline scripts anywhere.
   Exposes MMGRIconRestore.restore() so harnesses can exercise
   the path directly.
   ============================================================ */
(function () {
  'use strict';

  function restore() {
    var uses = document.querySelectorAll('use');
    var n = 0;
    for (var i = 0; i < uses.length; i++) {
      try {
        var u = uses[i];
        var href = u.getAttribute('href') || u.getAttribute('xlink:href');
        if (!href || href.charAt(0) === '#') continue; // in-document refs are safe
        var hadXlink = u.hasAttribute('xlink:href');
        u.removeAttribute('href');
        if (hadXlink) u.removeAttribute('xlink:href');
        void u.getBoundingClientRect(); // force style/blur invalidation
        u.setAttribute('href', href);
        if (hadXlink) u.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', href);
        n++;
      } catch (e) {
        /* fail-soft per node; never block the page */
      }
    }
    api.lastCount = n; // observable contract for harnesses
    return n;
  }

  // Exposed before the listener is registered so restore() can always
  // stamp lastCount regardless of event timing.
  var api = { restore: restore, lastCount: 0 };

  window.addEventListener('pageshow', function (ev) {
    if (ev && ev.persisted) restore();
  });

  window.MMGRIconRestore = api;
})();
