/* ============================================================
   My MaNaGeR — App Hub Skin Helper (theme pack)
   ------------------------------------------------------------
   Companion to mmgr-theme.js. Applies the chosen launcher skin
   (data-skin on <html>) before first paint, and drives the
   Customize modal: open/close, focus trap, live hover preview,
   and persistence. Device-only, like mmgr_theme.

   Scope: the skin CSS is scoped to body.db-page[data-skin="<slug>"]
   (plus .theme-preview[data-skin=...] for the modal previews), so a skin
   reaches every db-page surface - the launcher, the calculator, a project
   and the admin panel - and never the marketing pages, which do not load
   this script at all. (OWNER 2026-11-19: the calculator was the one db-page
   surface left on the default skin; see wire() for the cause.)

   CSP: external <script src> (covered by script-src 'self'); no
   inline-script hash churn. No emoji (owner hard gate).
   ============================================================ */
(function () {
  'use strict';

  var SKIN_KEY = 'mmgr_skin'; // e.g. 'vellum' | 'obsidian' | '' (default)

  /* Theme-pack skins carry their own intrinsic light/dark appearance. Locking
     that polarity stops a light skin from inheriting body.dark-mode's
     white-on-light component rules, and stops a dark skin from inheriting the
     cream default rail. ONLY the effective appearance is locked: mmgr_theme
     (the visitor's saved Light/Dark/System choice) is never written here, so
     returning to the default skin restores exactly what they picked.
     mmgr-theme.js.apply() consults getPolarity() - one source of truth. */
  var SKIN_POLARITY = {
    vellum: 'light',
    bento: 'light',
    permit: 'light',
    pegboard: 'light',
    editorial: 'light',
    obsidian: 'dark',
    departure: 'dark',
    guild: 'dark'
  };
  var currentSkin = '';
  function polarityFor(v) {
    return SKIN_POLARITY[v] || null;
  }
  function getPolarity() {
    return polarityFor(currentSkin);
  }

  function read() {
    try {
      return localStorage.getItem(SKIN_KEY);
    } catch (e) {
      return null;
    }
  }

  function write(v) {
    try {
      if (v) {
        localStorage.setItem(SKIN_KEY, v);
      } else {
        localStorage.removeItem(SKIN_KEY);
      }
    } catch (e) {
      /* ignore */
    }
  }

  // Thin event channel so other subsystems (the WebGL starfield, the
  // collaboration popover, etc.) can re-skin without a full reload. Listeners
  // receive CustomEvent('mmgr:skin', { detail: { skin } }) where skin is the
  // slug or '' for the default. We de-dupe so hover-preview flicker doesn't
  // spam consumers.
  var lastEmitted;
  function emit(v) {
    if (lastEmitted === v) {
      return;
    }
    lastEmitted = v;
    try {
      window.dispatchEvent(new CustomEvent('mmgr:skin', { detail: { skin: v || '' } }));
    } catch (e) {
      /* ignore */
    }
  }

  function applySkin(v) {
    var de = document.documentElement;
    var b = document.body;
    currentSkin = v || '';
    var polarity = getPolarity();
    // The skin CSS is scoped to body.db-page[data-skin="<slug>"] (plus
    // .theme-preview[data-skin=...] for the in-modal mini-mocks), so the
    // attribute MUST live on <body class="db-page"> for a surface to
    // actually take the skin. We also mirror it on <html> as a harmless
    // fallback; no skin selector targets <html>, but it keeps any future
    // html-scoped rule and the head-time paint consistent.
    if (v) {
      de.setAttribute('data-skin', v);
      if (b) {
        b.setAttribute('data-skin', v);
      }
    } else {
      de.removeAttribute('data-skin');
      if (b) {
        b.removeAttribute('data-skin');
      }
    }
    // Expose the skin's intrinsic polarity as a first-class attribute so CSS
    // can target it without duplicating the slug list (default skin = none).
    if (polarity) {
      de.setAttribute('data-skin-polarity', polarity);
      if (b) {
        b.setAttribute('data-skin-polarity', polarity);
      }
    } else {
      de.removeAttribute('data-skin-polarity');
      if (b) {
        b.removeAttribute('data-skin-polarity');
      }
    }
    emit(v);
    // mmgr-theme.js owns body.dark-mode; ask it to recompute now that the
    // polarity changed. apply() never writes localStorage, so no echo loop.
    if (window.MMGRTheme && window.MMGRTheme.apply) {
      window.MMGRTheme.apply();
    }
  }

  // Apply saved skin as early as possible (head script, before paint).
  applySkin(read());

  function modal() {
    return document.getElementById('customize-modal');
  }
  function isOpen() {
    var m = modal();
    return !!m && !m.hasAttribute('hidden');
  }

  var lastFocus = null;

  function markSelected(v) {
    var m = modal();
    if (!m) {
      return;
    }
    var cards = m.querySelectorAll('[data-skin-set]');
    for (var i = 0; i < cards.length; i++) {
      var on = (cards[i].getAttribute('data-skin-set') || '') === (v || '');
      cards[i].classList.toggle('is-selected', on);
      cards[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function openModal() {
    var m = modal();
    if (!m || isOpen()) {
      return;
    }
    lastFocus = document.activeElement;
    m.removeAttribute('hidden');
    document.body.classList.add('customize-open');
    markSelected(read());
    var f = m.querySelector('[data-customize-focus]') || m.querySelector('.cm-close');
    if (f && f.focus) {
      f.focus();
    }
    document.addEventListener('keydown', onKey, true);
  }

  function closeModal() {
    var m = modal();
    if (!m || !isOpen()) {
      return;
    }
    m.setAttribute('hidden', '');
    document.body.classList.remove('customize-open');
    document.removeEventListener('keydown', onKey, true);
    if (lastFocus && lastFocus.focus) {
      lastFocus.focus();
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key === 'Tab') {
      trapFocus(e);
    }
  }

  function trapFocus(e) {
    var m = modal();
    if (!m) {
      return;
    }
    var f = m.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!f.length) {
      return;
    }
    var first = f[0];
    var last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function wire() {
    // OWNER 2026-11-19 (surface-language): apply the saved skin to <body>
    // FIRST, before the customize-modal guard below. The head-time applySkin()
    // runs before <body> is parsed, so it can only reach <html>; this call is
    // the one that reaches the body - and it used to sit BEHIND the guard, so
    // every page without a #customize-modal (calculator, project, admin) kept
    // the default skin while the launcher changed. The modal wiring below is
    // still launcher-only, which is correct: those pages have no customize UI.
    applySkin(read());

    var m = modal();
    if (!m) {
      return;
    }

    // Delegated clicks for open / close / apply.
    document.addEventListener('click', function (e) {
      var open = e.target.closest('[data-customize-open]');
      if (open) {
        e.preventDefault();
        openModal();
        return;
      }

      var close = e.target.closest('[data-customize-close]');
      if (close) {
        e.preventDefault();
        closeModal();
        return;
      }

      // Click on the backdrop (the modal element itself) closes.
      if (isOpen() && e.target === m) {
        closeModal();
        return;
      }

      // Apply a theme (persist + live apply).
      var set = e.target.closest('[data-skin-set]');
      if (set) {
        var v = set.getAttribute('data-skin-set');
        write(v);
        applySkin(v);
        markSelected(v);
        return;
      }
    });

    // Live hover/focus preview without persisting.
    var cards = m.querySelectorAll('[data-skin-preview]');
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        var v = card.getAttribute('data-skin-preview');
        function preview() {
          applySkin(v);
        }
        function revert() {
          applySkin(read());
          markSelected(read());
        }
        card.addEventListener('mouseenter', preview);
        card.addEventListener('mouseleave', revert);
        card.addEventListener('focus', preview);
        card.addEventListener('blur', revert);
      })(cards[i]);
    }
  }

  window.MMGR_SKIN = {
    openModal: openModal,
    closeModal: closeModal,
    applySkin: applySkin,
    getSkin: read,
    getPolarity: getPolarity,
    polarityFor: polarityFor
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
