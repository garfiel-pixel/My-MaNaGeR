/* My MaNaGeR - Performance Mode boot (REFINEMENT-DIRECTIVE-2026-10-24.md, PERF-1).
   Loads with data-sync="1" right after js/mmgr-theme.js on every page, so the
   stored preference is on <html> BEFORE first paint: the [data-perf='on'] CSS
   kill block then stands the blur, the big shadows and the infinite animation
   down on pages that never load js/mmgr-perf.js (calculator, marketing,
   sign-in), instead of only on app.html and admin.html.

   Contract, deliberately narrow: it sets ONE attribute from storage and does
   nothing else. js/mmgr-perf.js stays the single owner of the preference - it
   defines MMGR.Perf, writes the same key and re-applies the same attribute on
   every toggle - so this file must never create a stub namespace that would
   shadow it. No dependencies, no storage key of its own, no event bus.

   REWRITTEN 2026-10-25: the version that shipped with the cyan/magenta commit
   ended its IIFE with `this._subs` inside a 'use strict' function called as a
   plain function, where `this` is undefined - it threw a TypeError on every
   page it loaded on (none, because it was also referenced by no page), wrote
   window.ns.Perf while the app reads window.MMGR.Perf, and carried an
   eslint-disable directive at the top to hide both problems. */
(function () {
  'use strict';

  var on = false;
  try {
    on = window.localStorage.getItem('mmgr_perf_mode') === 'on';
  } catch (e) {
    on = false; /* storage blocked: ship the pretty default */
  }

  var de = document.documentElement;
  if (de) {
    de.setAttribute('data-perf', on ? 'on' : 'off');
  }
})();
