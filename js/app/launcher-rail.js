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

  /* ---- Rail GROUP dropdowns (owner 2026-11-19, surface-language) ----------
     The six group headings ([data-rail-toggle^="rail-grp-"]) collapse their
     .db-g-body panel through the ONE delegated handler in app.html - this
     module never shows or hides anything itself, it only remembers which
     groups this person closed.

     Scope: the map is keyed per identity, so two people sharing a browser
     each keep their own layout and a signed-out visitor keeps 'anon'. The
     scope is persisted separately (mmgr_rail_scope) because the identity only
     arrives over the network AFTER this deferred bundle has run - reading the
     last known scope lets the first paint restore the right layout instead of
     flashing every group open and then collapsing them.

     Every group defaults to OPEN: a first visit, a cleared storage and a
     signed-out visitor all see the full rail. Only an explicit collapse is
     remembered. ----------------------------------------------------------- */
  var GROUP_KEY = 'mmgr_rail_groups';
  var SCOPE_KEY = 'mmgr_rail_scope';
  var scope = 'anon';

  function readJson(key) {
    try {
      var raw = localStorage.getItem(key);
      var val = raw ? JSON.parse(raw) : null;
      return val && typeof val === 'object' ? val : {};
    } catch (e) {
      return {};
    }
  }

  function groupScope(user) {
    if (!user) {
      return 'anon';
    }
    var id = user.sub || user.email || '';
    return id ? String(id) : 'anon';
  }

  function groupButtons() {
    return document.querySelectorAll('[data-rail-toggle^="rail-grp-"]');
  }

  function applyGroup(btn) {
    var id = btn.getAttribute('data-rail-toggle');
    var panel = document.getElementById(id);
    if (!panel) {
      return;
    }
    var mine = readJson(GROUP_KEY)[scope];
    var isOpen = !(mine && typeof mine === 'object' && mine[id] === 0);
    panel.hidden = !isOpen;
    btn.classList.toggle('open', isOpen);
    btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }

  function restoreGroups() {
    Array.prototype.forEach.call(groupButtons(), applyGroup);
  }

  function wireGroups() {
    try {
      scope = localStorage.getItem(SCOPE_KEY) || 'anon';
    } catch (e) {
      scope = 'anon';
    }
    restoreGroups();

    document.addEventListener('click', function (e) {
      var btn =
        e.target && e.target.closest ? e.target.closest('[data-rail-toggle^="rail-grp-"]') : null;
      if (!btn) {
        return;
      }
      var id = btn.getAttribute('data-rail-toggle');
      var panel = document.getElementById(id);
      if (!panel) {
        return;
      }
      // Read the panel AFTER every click handler has run: app.html's handler
      // owns the toggle, so the state is only settled once this turn ends.
      setTimeout(function () {
        var all = readJson(GROUP_KEY);
        var mine = all[scope] && typeof all[scope] === 'object' ? all[scope] : {};
        mine[id] = panel.hidden ? 0 : 1;
        all[scope] = mine;
        try {
          localStorage.setItem(GROUP_KEY, JSON.stringify(all));
        } catch (err) {}
      }, 0);
    });

    document.addEventListener('mmgr:user-changed', function (e) {
      scope = groupScope(e && e.detail);
      try {
        localStorage.setItem(SCOPE_KEY, scope);
      } catch (err) {}
      restoreGroups();
    });
    document.addEventListener('mmgr:google-signed-out', function () {
      scope = 'anon';
      try {
        localStorage.setItem(SCOPE_KEY, scope);
      } catch (err) {}
      restoreGroups();
    });
  }

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

  /* Group persistence is independent of the hover-peek, so it is wired
     unconditionally - the peek below is desktop-fine-pointer only. */
  wireGroups();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  ns.LauncherRail = {
    wire: wire,
    openPeek: openPeek,
    closePeek: closePeek,
    restoreGroups: restoreGroups
  };
})((window.MMGR = window.MMGR || {}));
