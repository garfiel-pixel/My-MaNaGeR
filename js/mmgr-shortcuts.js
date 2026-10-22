/* ============================================================
   My MaNaGeR - Keyboard shortcuts + the shortcut help sheet
   ------------------------------------------------------------
   AUDIT-DIRECTIVE-2026-10-18, task M-5. A repeat user should be
   able to work without the mouse:

     ?      open the list of shortcuts
     /      go to the assistant box and start typing
     Enter  (calculator page) work out the estimate

   The module owns its own dialog, its own clicks and its own keys:
     - no inline script, so the CSP inline-script hash set never moves;
     - no ACTION_MAP entry, so the app's action table stays as it is;
     - it loads from its own <script src> on project.html and on
       calculator.html, and it sits in the service-worker shell so it
       still works with no network.

   THE LIST LIVES HERE, ONCE. The sheet and the drawer's shortcut
   block are both rendered from TABLE, so the two can never disagree
   with each other (a shortcut that the sheet lists but the drawer
   does not is how a help page starts lying).

   Plain-language rule: every "what" is something a site manager
   would say out loud. No jargon, no engineer words.
   ============================================================ */
(function () {
  'use strict';

  var MMGR = window.MMGR || (window.MMGR = {});

  var SHEET_ID = 'kb-sheet';
  var GRID_ID = 'kb-sheet-grid';
  var DRAWER_GRID_ID = 'kb-drawer-grid';

  // One row per shortcut. `keys` is the chip on the key cap, `what`
  // is the plain-language description.
  var TABLE = {
    app: [
      { keys: '?', what: 'Show this list of shortcuts' },
      { keys: '/', what: 'Open the assistant and start typing your question' },
      { keys: 'F', what: 'Focus Mode , isolate the active panel' },
      { keys: 'Ctrl/⌘ + Z', what: 'Undo (outside text fields)' },
      { keys: 'Ctrl/⌘ + Shift + Z', what: 'Redo' },
      { keys: 'Esc', what: 'Close drawer / modals' },
      { keys: 'Enter / Space', what: 'Change the RACI letter in the cell you are on' },
      { keys: '← / →', what: 'Go back or forward through the RACI letters' }
    ],
    calc: [
      { keys: '?', what: 'Show this list of shortcuts' },
      { keys: '/', what: 'Go to the assistant box and ask about this estimate' },
      { keys: 'Enter', what: 'Work out the estimate , the same as the Calculate button' },
      { keys: 'Esc', what: 'Close any dialog' }
    ]
  };

  // The calculator's text boxes that are part of the price itself.
  // Number boxes are matched by type, so this list is only for the
  // text ones (a name, a unit, a piece size).
  var CALC_TEXT_FIELDS = ['calc-custom-name', 'calc-custom-unit', 'calc-piece-size'];

  var lastFocus = null;

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Which page is this? The module stays completely inert anywhere
  // else (the projects launcher, the admin page, marketing pages).
  function pageKind() {
    if (document.getElementById('calc-input-card')) {
      return 'calc';
    }
    if (document.getElementById('ai-win')) {
      return 'app';
    }
    return '';
  }

  function rows() {
    return TABLE[pageKind()] || [];
  }

  function gridHtml() {
    var list = rows();
    var out = '';
    for (var i = 0; i < list.length; i++) {
      out += '<span class="kbd">' + esc(list[i].keys) + '</span> ' + esc(list[i].what);
    }
    return out;
  }

  // The boxes that take written characters. A shortcut that uses a
  // character ("?" or "/") must keep quiet in one of these, or it would
  // eat what the user is writing.
  var TEXT_INPUT_TYPES = ['text', 'search', 'email', 'url', 'tel', 'password'];

  function takesText(t) {
    if (!t) {
      return false;
    }
    if (t.isContentEditable) {
      return true;
    }
    var tag = (t.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'select') {
      return true;
    }
    if (tag !== 'input') {
      return false;
    }
    var type = (t.getAttribute('type') || 'text').toLowerCase();
    return TEXT_INPUT_TYPES.indexOf(type) > -1;
  }

  function inDialog(el) {
    if (!el || !el.closest) {
      return false;
    }
    return !!el.closest('[role="dialog"], .modal, .kb-sheet');
  }

  function sheetEl() {
    return document.getElementById(SHEET_ID);
  }

  function isOpen() {
    var s = sheetEl();
    return !!(s && s.classList.contains('open'));
  }

  function buildSheet() {
    if (sheetEl() || !pageKind()) {
      return;
    }
    var el = document.createElement('div');
    el.id = SHEET_ID;
    el.className = 'kb-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'kb-sheet-title');
    el.innerHTML =
      '<div class="mb">' +
      '<div class="mh">' +
      '<span class="mt" id="kb-sheet-title">' +
      '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-key"></use></svg>' +
      ' Keyboard shortcuts</span>' +
      '<button type="button" class="dc" data-mmks="close" aria-label="Close the keyboard shortcuts">' +
      '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg>' +
      '</button>' +
      '</div>' +
      '<div class="mbody">' +
      '<div class="kbd-grid" id="' +
      GRID_ID +
      '"></div>' +
      '<p class="kb-note">These keys work when you are not typing in a box.</p>' +
      '</div>' +
      '<div class="mf">' +
      '<button type="button" class="btn btn-n btn-s" data-mmks="close">Close</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(el);
    var grid = document.getElementById(GRID_ID);
    if (grid) {
      grid.innerHTML = gridHtml();
    }
  }

  function open() {
    buildSheet();
    var s = sheetEl();
    if (!s) {
      return false;
    }
    var grid = document.getElementById(GRID_ID);
    if (grid) {
      grid.innerHTML = gridHtml();
    }
    lastFocus = document.activeElement;
    s.classList.add('open');
    var close = s.querySelector('[data-mmks="close"]');
    if (close && close.focus) {
      close.focus();
    }
    return true;
  }

  function close() {
    var s = sheetEl();
    if (!s) {
      return false;
    }
    s.classList.remove('open');
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) {
      lastFocus.focus();
    }
    lastFocus = null;
    return true;
  }

  function toggle() {
    return isOpen() ? close() : open();
  }

  // Keep Tab inside the sheet while it is open.
  function trapTab(e) {
    var s = sheetEl();
    if (!s) {
      return;
    }
    var focusables = s.querySelectorAll('button, [href], input, select, textarea, [tabindex]');
    if (!focusables.length) {
      return;
    }
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    var active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // "/" - go to the assistant box.
  function focusAssistant() {
    var kind = pageKind();
    if (kind === 'calc') {
      var card = document.getElementById('calc-ai-card');
      var box = document.getElementById('calc-ai-input');
      if (box && !box.disabled) {
        box.focus();
        if (box.scrollIntoView) {
          box.scrollIntoView({ block: 'center' });
        }
        return true;
      }
      // Signed out: the question box is closed until you sign in, so the
      // cursor cannot go in it. Take the user to the card and to the sign-in
      // link instead - the key still does something real.
      if (card) {
        if (card.scrollIntoView) {
          card.scrollIntoView({ block: 'center' });
        }
        var link = card.querySelector('.bcp-ai-signin') || card.querySelector('a[href*="signin"]');
        if (!link) {
          link = card.querySelector('.bcp-ai-me-link');
        }
        if (link && link.focus) {
          link.focus();
          return true;
        }
      }
      return false;
    }
    var win = document.getElementById('ai-win');
    if (win && win.classList.contains('open')) {
      var q = document.getElementById('ai-q');
      if (q) {
        q.focus();
        return true;
      }
    }
    // Not open yet: open it. The window focuses its own box, and the
    // signed-out case opens the sign-in sheet, exactly like the
    // assistant button in the header.
    if (MMGR.AiWin && typeof MMGR.AiWin.open === 'function') {
      MMGR.AiWin.open();
      return true;
    }
    return false;
  }

  // "Enter" on the calculator page - work out the estimate.
  function isCalcPriceField(el) {
    if (!el || el.tagName !== 'INPUT') {
      return false;
    }
    if (inDialog(el)) {
      return false;
    }
    var type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type === 'number') {
      return !!el.closest('#calc-input-card');
    }
    if (type === 'text') {
      return CALC_TEXT_FIELDS.indexOf(el.id) > -1;
    }
    return false;
  }

  function calculate() {
    var btn = document.querySelector('[data-action="calcRun"]');
    if (!btn) {
      return false;
    }
    btn.click();
    return true;
  }

  function onKeyDown(e) {
    if (!pageKind()) {
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }

    // The sheet is modal: while it is open it takes every key.
    if (isOpen()) {
      if (e.key === 'Tab') {
        trapTab(e);
      } else if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        close();
      } else {
        e.preventDefault();
      }
      e.stopPropagation();
      return;
    }

    // "Enter" is checked BEFORE the typing guard: this one shortcut is
    // MEANT to fire from inside a price field. Every other shortcut is
    // skipped while the user is typing, so it can never eat a character.
    if (e.key === 'Enter' && pageKind() === 'calc' && isCalcPriceField(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      calculate();
      return;
    }

    // A NUMBER box cannot hold a slash or a question mark, so the
    // shortcut is free to fire there. That matters on the calculator,
    // where the user lives in the price fields: "/" has to reach the
    // assistant from there. In a box that takes written characters the
    // shortcut stays quiet.
    if (takesText(e.target)) {
      return;
    }

    if (e.key === '?') {
      e.preventDefault();
      e.stopPropagation();
      open();
      return;
    }

    if (e.key === '/') {
      e.preventDefault();
      e.stopPropagation();
      focusAssistant();
    }
  }

  // The drawer's shortcut block is rendered from the same table, so the
  // sheet and the drawer can never drift apart.
  function paintDrawerGrid() {
    var grid = document.getElementById(DRAWER_GRID_ID);
    if (!grid) {
      return;
    }
    grid.innerHTML = gridHtml();
  }

  document.addEventListener('keydown', onKeyDown, true);

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-mmks]') : null;
    if (!el) {
      return;
    }
    var act = el.getAttribute('data-mmks');
    if (act === 'open') {
      e.preventDefault();
      open();
    } else if (act === 'close') {
      e.preventDefault();
      close();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      buildSheet();
      paintDrawerGrid();
    });
  } else {
    buildSheet();
    paintDrawerGrid();
  }

  MMGR.Shortcuts = {
    open: open,
    close: close,
    toggle: toggle,
    isOpen: isOpen,
    rows: rows
  };
})();
