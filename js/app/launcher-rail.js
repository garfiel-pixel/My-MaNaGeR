/* ============================================================
   Launcher rail: hover-peek (I-14) + first-load reveal (B7 parity)
   ============================================================
   The collapsed icon strip (.sidebar-icons) sits in a ~64px lane. On a
   fine-pointer desktop, hovering that lane slides the full panel (.db-side)
   in as an OVERLAY (body.rail-hover-open, see app.html CSS). The strip hides
   under the panel while open, so a naive mouseenter/mouseleave on the strip
   would flicker (the strip vanishes the moment it opens). Instead we watch
   the pointer position with hysteresis: open at the lane, keep open across
   the panel, close only once the pointer clears the panel to the right.
   The one-shot first-load reveal already lives in app.html's inline
   rail-nudge block (mmgr_rail_nudge, harnessed by qa-shell-first-load.cjs),
   so this module deliberately does NOT duplicate it - it only adds the
   hover-peek the CSS was missing a JS toggle for. The pinned-open state
   (body.side-open, hamburger) is left to app.html's own rail script.
   ============================================================ */
(function (ns) {
  'use strict';

  var LANE_W = 64; // --rail-closed-w
  var PANEL_W = 340; // close only after the pointer clears the opened panel

  function body() {
    return document.body;
  }

  function desktopFine() {
    return window.matchMedia && window.matchMedia('(min-width: 769px) and (pointer: fine)').matches;
  }

  function openPeek() {
    var b = body();
    if (b.classList.contains('side-open')) return;
    b.classList.add('rail-hover-open');
  }

  function closePeek() {
    body().classList.remove('rail-hover-open');
  }

  function wire() {
    if (!desktopFine()) return;

    document.addEventListener('mousemove', function (e) {
      if (!desktopFine()) return;
      if (body().classList.contains('side-open')) {
        closePeek();
        return;
      }
      if (e.clientX <= LANE_W) openPeek();
      else if (e.clientX > PANEL_W) closePeek();
    });

    // Keyboard parity: tabbing into the strip reveals the panel; leaving closes.
    var rail = document.querySelector('.sidebar-icons');
    if (rail) {
      rail.addEventListener('focusin', openPeek);
      rail.addEventListener('focusout', function (e) {
        if (!(e.relatedTarget && rail.contains(e.relatedTarget))) closePeek();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  ns.LauncherRail = { wire: wire, openPeek: openPeek, closePeek: closePeek };
})((window.MMGR = window.MMGR || {}));
