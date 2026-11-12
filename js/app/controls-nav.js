/* ============================================================
   controls-nav.js — Controls drawer accordion (T-07, UI-IA-AND-MCP
   directive 2026-11-11).
   ------------------------------------------------------------
   Extracted from the inline IIFE that used to live in project.html. The
   behaviour is ported EXACTLY (same caret, same 260ms -> none max-height
   transition, same role/tabindex/aria, same Enter/Space handling). The one
   change is that section state is driven by markup attributes instead of
   string-matching the section label:

     data-ctl-group="<key>"  every .ctl-sec (stable id for deep links)
     data-ctl-open="1"        sections open by default (Profile, Share &
                              Access, Workspace, Advanced Packs)
     data-ctl-static="1"      conditional sections that never toggle
                              (Danger Zone)

   The click path is inspectable: init() tags every toggleable section with
   data-action="ctlToggle", and the global data-action dispatcher
   (mmgr-app.js) routes it to ACTION_MAP.ctlToggle -> AppControls.toggle().
   Keyboard Enter/Space is handled here because .ctl-sec is a role=button
   div, not a native button.

   Exports: init, toggle(key), setOpen(key, bool), open(), close(),
   focus(group, tab), current().
   ============================================================ */
(function (MMGR) {
  'use strict';
  var ctrl = null;
  var SECS = [];

  function keyOf(sec) {
    return sec ? sec.getAttribute('data-ctl-group') : null;
  }
  function secByKey(key) {
    return ctrl ? ctrl.querySelector('.ctl-sec[data-ctl-group="' + key + '"]') : null;
  }
  function groupOf(key) {
    return ctrl ? ctrl.querySelector('.ctl-sec-group[data-ctl-group-body="' + key + '"]') : null;
  }

  function initControls() {
    ctrl = document.getElementById('db-ctrl');
    if (!ctrl) {
      return;
    }
    SECS = Array.prototype.slice.call(ctrl.querySelectorAll('.ctl-sec'));
    SECS.forEach(function (sec) {
      // Caret icon (matches the original exactly).
      var caret = document.createElement('svg');
      caret.setAttribute('class', 'ico ico-caret');
      caret.setAttribute('aria-hidden', 'true');
      caret.innerHTML = '<use href="css/mmgr-icons.svg#i-arrow-right"></use>';
      sec.appendChild(caret);

      var isStatic = sec.hasAttribute('data-ctl-static');
      var isOpen = sec.hasAttribute('data-ctl-open');
      if (isOpen) {
        sec.classList.add('open');
      }

      // Static (conditional) sections: never a toggle, but keep the caret.
      if (isStatic) {
        return;
      }

      sec.setAttribute('data-ctl-toggle', '');
      sec.setAttribute('data-action', 'ctlToggle');
      sec.setAttribute('role', 'button');
      sec.setAttribute('tabindex', '0');
      sec.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

      // Wrap the content that follows this section (up to the next .ctl-sec)
      // in a collapsible group, exactly like the original.
      var group = document.createElement('div');
      group.className = 'ctl-sec-group' + (isOpen ? '' : ' collapsed');
      group.setAttribute('data-ctl-group-body', keyOf(sec));
      var next = sec.nextElementSibling;
      var toMove = [];
      while (next && !next.classList.contains('ctl-sec')) {
        toMove.push(next);
        next = next.nextElementSibling;
      }
      toMove.forEach(function (el) {
        group.appendChild(el);
      });
      sec.parentNode.insertBefore(group, sec.nextSibling);
    });

    // Tabbed groups: each group body that carries internal tabs defaults to
    // its first tab — show that panel, hide the rest, mark the tab active.
    // Groups without tabs are left untouched.
    SECS.forEach(function (sec) {
      var body = groupOf(keyOf(sec));
      if (!body) {
        return;
      }
      var tabs = body.querySelectorAll('.dtab[data-ctl-tab]');
      if (!tabs.length) {
        return;
      }
      switchTab(tabs[0]);
    });

    // Keyboard handling for role=button sections (Enter/Space). Delegated so
    // it survives the content re-parenting above.
    ctrl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') {
        return;
      }
      var sec = e.target.closest ? e.target.closest('.ctl-sec[data-ctl-toggle]') : null;
      if (!sec) {
        return;
      }
      e.preventDefault();
      toggle(keyOf(sec));
    });
  }

  function toggle(key) {
    var sec = secByKey(key);
    if (!sec || sec.hasAttribute('data-ctl-static')) {
      return;
    }
    setOpen(key, !sec.classList.contains('open'));
  }

  function setOpen(key, open) {
    var sec = secByKey(key);
    if (!sec) {
      return;
    }
    var group = groupOf(key);
    if (open) {
      sec.classList.add('open');
      if (group) {
        group.classList.remove('collapsed');
        group.style.maxHeight = group.scrollHeight + 'px';
        setTimeout(function () {
          if (group) {
            group.style.maxHeight = 'none';
          }
        }, 260);
      }
      sec.setAttribute('aria-expanded', 'true');
    } else {
      sec.classList.remove('open');
      if (group) {
        group.classList.add('collapsed');
        group.style.maxHeight = group.scrollHeight + 'px';
        requestAnimationFrame(function () {
          if (group) {
            group.style.maxHeight = '0px';
          }
        });
      }
      sec.setAttribute('aria-expanded', 'false');
    }
  }

  // Switch the active tab within a group body. The tab element carries
  // data-ctl-tab; the matching panel carries data-ctl-panel. Exactly one
  // panel is visible per group (T-12 gate). Used by data-action="ctlTab".
  function switchTab(tabEl) {
    var body = tabEl.closest ? tabEl.closest('[data-ctl-group-body]') : null;
    if (!body) {
      return;
    }
    var key = tabEl.getAttribute('data-ctl-tab');
    body.querySelectorAll('[data-ctl-panel]').forEach(function (p) {
      p.classList.toggle('is-hide', p.getAttribute('data-ctl-panel') !== key);
    });
    body.querySelectorAll('.dtab[data-ctl-tab]').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-ctl-tab') === key);
    });
  }

  function open() {
    SECS.forEach(function (s) {
      if (!s.hasAttribute('data-ctl-static')) {
        setOpen(keyOf(s), true);
      }
    });
  }
  function close() {
    SECS.forEach(function (s) {
      if (!s.hasAttribute('data-ctl-static')) {
        setOpen(keyOf(s), false);
      }
    });
  }
  // Open a group and (optionally) select one of its tabs. Used by the deep link
  // (?ctl=<group>.<tab>), search (T-13) and openPacks(). The tab lives inside
  // the group body; switchTab shows its panel and marks it active.
  function focus(group, tab) {
    var sec = secByKey(group);
    if (!sec) {
      return;
    }
    setOpen(group, true);
    sec.focus();
    if (tab) {
      var body = groupOf(group);
      var tabEl = body ? body.querySelector('.dtab[data-ctl-tab="' + tab + '"]') : null;
      if (tabEl) {
        switchTab(tabEl);
      }
    }
  }
  function current() {
    return SECS.filter(function (s) {
      return s.classList.contains('open');
    }).map(keyOf);
  }

  var api = {
    init: initControls,
    toggle: toggle,
    setOpen: setOpen,
    switchTab: switchTab,
    open: open,
    close: close,
    focus: focus,
    current: current
  };
  MMGR.AppControls = api;

  // Auto-boot: the bundle is deferred, so the document is parsed; guard for
  // the rare case it is not.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initControls);
  } else {
    initControls();
  }
})(window.MMGR || (window.MMGR = {}));
