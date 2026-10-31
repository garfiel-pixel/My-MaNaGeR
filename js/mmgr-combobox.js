/* ============================================================
   My MaNaGeR - the owned listbox (UI-1)
   REFINEMENT-DIRECTIVE-2026-10-24, section 4, UI-1 layer two.

   WHY THIS EXISTS
   The dark-mode trade list was unreadable because the popup is drawn by the
   BROWSER, not by this stylesheet: no rule can colour an <optgroup> heading
   reliably, no test can screenshot the popup, and Chrome, Edge, Firefox and
   Windows each draw it differently. The CSS patch (css/mmgr.css, the (15) and
   UI-1 blocks) makes the native popup agree with the theme; this module removes
   the native popup from the two long lists altogether, so what the user sees is
   what this project draws and what a test can measure.

   THE CONTRACT (and why the old select stays)
   The original <select> is NOT replaced. It stays in the DOM, hidden, as the
   source of truth: the combobox writes its value and dispatches `change`, so
   every handler that already reads `#calc-work` / `#calc-family` - recalls,
   saved estimates, the family filter, the book picker - keeps working with no
   change and no second code path. Fragment snapshots keep reading the select.

   ACCESSIBILITY
   role="combobox" on the text input, aria-expanded, aria-controls,
   aria-autocomplete="list" and aria-activedescendant while open;
   role="listbox" with role="group" per trade family and role="option" per row;
   aria-selected on the chosen row. Arrow keys move, Home/End jump, Enter picks,
   Escape closes and restores, typing filters, and a group heading can never be
   selected because it is not an option.

   Kill switch: localStorage mmgr_flag_comboboxPicker = '0' leaves the native
   select on screen (with the CSS patch) and this module does nothing.
   ============================================================ */
(function (ns) {
  'use strict';

  var seq = 0;
  var openInst = null;

  /* The listbox is mounted on <body> (see Enhance), OUTSIDE the .card that
     holds the control. A card that re-renders can therefore drop the control
     (and its wrapper) while the popup stays behind, with no input left to
     close it. A popup is live only while the wrapper that owns it is in the
     document; everything else is removed. Called at boot, before every
     enhance (a re-render is when an orphan appears) and exposed for the gate. */
  function sweepOrphans() {
    var pops = document.querySelectorAll('.mmcb-pop');
    Array.prototype.forEach.call(pops, function (pop) {
      var inst = pop.__mmcbInst;
      if (!inst || !inst.wrap || !inst.wrap.isConnected) {
        pop.remove();
      }
    });
  }

  function flagOn(name) {
    try {
      return localStorage.getItem('mmgr_flag_' + name) !== '0';
    } catch (e) {
      return true;
    }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** The text a closed control shows: the selected option's own label. */
  function selectedText(sel) {
    var o = sel.options[sel.selectedIndex];
    return o
      ? String(o.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  }

  /** The visible name of the control, taken from the label the page already has. */
  function labelFor(sel, uid) {
    var id = sel.id;
    var label = id ? document.querySelector('label[for="' + id + '"]') : null;
    if (label) {
      if (!label.id) {
        label.id = 'mmcb-lbl-' + uid;
      }
      return label.id; // ok: an element id from the page's own markup, or one we generated
    }
    return '';
  }

  function Enhance(sel) {
    var uid = String(++seq); // ok: an increasing counter - digits only, never free text
    var inst = { sel: sel, uid: uid, filtering: false, items: [], active: -1 };
    var raf = 0; // the live tracking frame, 0 when the popup is closed

    var wrap = document.createElement('div');
    wrap.className = 'mmcb';
    wrap.setAttribute('data-for', sel.id || '');

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'mmcb-input';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', 'mmcb-list-' + uid);
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    var lblId = labelFor(sel, uid);
    if (lblId) {
      input.setAttribute('aria-labelledby', lblId);
    } else {
      input.setAttribute('aria-label', sel.getAttribute('aria-label') || 'Choose');
    }
    if (sel.getAttribute('aria-describedby')) {
      input.setAttribute('aria-describedby', sel.getAttribute('aria-describedby'));
    }

    var btn = document.createElement('span');
    btn.className = 'mmcb-btn';
    btn.setAttribute('aria-hidden', 'true');
    btn.innerHTML =
      // ok: a fixed sprite reference - no variable reaches this markup
      '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-arrow-down"></use></svg>';

    var pop = document.createElement('div');
    pop.className = 'mmcb-pop';
    // The same key the wrapper carries, so one selector reaches both sides:
    // `.mmcb[data-for="calc-work"]` (the control) and
    // `.mmcb-pop[data-for="calc-work"]` (the portal).
    pop.setAttribute('data-for', sel.id || '');
    pop.hidden = true;
    pop.innerHTML =
      // ok: literal markup; the only interpolation is our own numeric uid and
      // aria-labelledby, which is an element id we generated above
      '<div class="mmcb-scrim"></div>' +
      '<div class="mmcb-sheet">' +
      '<div class="mmcb-list" id="mmcb-list-' +
      uid +
      '" role="listbox"' +
      (lblId ? ' aria-labelledby="' + lblId + '"' : '') +
      '></div>' +
      '</div>';

    wrap.appendChild(input);
    wrap.appendChild(btn);
    // Portal: a .card carries `contain: layout paint`, which makes the card the
    // containing block for a position:fixed descendant and clips it. Moving the
    // popup to <body> restores viewport coordinates (place() writes rect values)
    // and lets it paint over the card edge it belongs to.
    document.body.appendChild(pop);
    sel.insertAdjacentElement('afterend', wrap);

    // The select stays in the DOM as the source of truth, but it must not be
    // focusable, visible or announceable twice.
    sel.classList.add('mmcb-native');
    sel.setAttribute('tabindex', '-1');
    sel.setAttribute('aria-hidden', 'true');

    inst.wrap = wrap;
    inst.input = input;
    inst.pop = pop;
    inst.list = pop.querySelector('.mmcb-list');
    pop.__mmcbInst = inst;
    sel.__mmcb = inst;

    function syncLabel() {
      input.value = selectedText(sel);
      input.disabled = !!sel.disabled;
      wrap.classList.toggle('is-disabled', !!sel.disabled);
    }

    function optionRow(o) {
      inst.n = (inst.n || 0) + 1;
      var row = document.createElement('div');
      row.className = 'mmcb-opt';
      row.setAttribute('role', 'option');
      row.setAttribute('data-value', o.value);
      row.setAttribute('id', 'mmcb-opt-' + uid + '-' + inst.n);
      row.setAttribute('aria-selected', o.selected ? 'true' : 'false');
      if (o.disabled) {
        row.setAttribute('aria-disabled', 'true');
      }
      row.innerHTML =
        '<span class="mmcb-opt-txt">' +
        esc(
          String(o.textContent || '')
            .replace(/\s+/g, ' ')
            .trim()
        ) +
        '</span>' +
        (o.selected
          ? '<svg class="ico mmcb-tick" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg>'
          : '');
      return row;
    }

    function build(filter) {
      var q = String(filter || '')
        .trim()
        .toLowerCase();
      var found = document.createDocumentFragment();
      var items = [];
      var kids = Array.prototype.slice.call(sel.children);
      kids.forEach(function (kid) {
        if (kid.tagName === 'OPTGROUP') {
          var group = document.createElement('div');
          group.className = 'mmcb-grp-wrap';
          group.setAttribute('role', 'group');
          group.setAttribute('aria-label', kid.label || '');
          var head = document.createElement('div');
          head.className = 'mmcb-grp';
          head.setAttribute('aria-hidden', 'true');
          head.textContent = kid.label || '';
          group.appendChild(head);
          Array.prototype.forEach.call(kid.children, function (o) {
            if (o.tagName !== 'OPTION') {
              return;
            }
            var txt = String(o.textContent || '').toLowerCase();
            if (q && txt.indexOf(q) === -1) {
              return;
            }
            var row = optionRow(o);
            group.appendChild(row);
            items.push(row);
          });
          if (group.querySelector('[role="option"]')) {
            found.appendChild(group);
          }
          return;
        }
        if (kid.tagName === 'OPTION') {
          var solo = String(kid.textContent || '').toLowerCase();
          if (q && solo.indexOf(q) === -1) {
            return;
          }
          var row1 = optionRow(kid);
          found.appendChild(row1);
          items.push(row1);
        }
      });
      inst.list.innerHTML = '';
      if (!items.length) {
        var empty = document.createElement('div');
        empty.className = 'mmcb-empty';
        empty.setAttribute('role', 'presentation');
        empty.textContent = 'No match';
        inst.list.appendChild(empty);
        inst.items = [];
        inst.active = -1;
        input.removeAttribute('aria-activedescendant');
        return;
      }
      inst.list.appendChild(found);
      inst.items = items;
      var chosen = items.filter(function (r) {
        return r.getAttribute('aria-selected') === 'true';
      })[0];
      inst.active = chosen ? items.indexOf(chosen) : 0;
      paintActive();
    }

    function paintActive() {
      inst.items.forEach(function (r, i) {
        r.classList.toggle('is-active', i === inst.active);
      });
      var cur = inst.items[inst.active];
      if (cur) {
        input.setAttribute('aria-activedescendant', cur.id);
        if (cur.scrollIntoView) {
          cur.scrollIntoView({ block: 'nearest' });
        }
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function detach() {
      document.removeEventListener('pointerdown', onDocDown, true);
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onScroll);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', onScroll);
        window.visualViewport.removeEventListener('scroll', onScroll);
      }
    }

    function close() {
      if (!wrap.isConnected) {
        // The card re-rendered without us: there is nothing to close, so take
        // the portal and its listeners with it instead of leaving a stranded
        // popup on <body> that only a dead instance can hear.
        cancelAnimationFrame(raf);
        raf = 0;
        detach();
        pop.remove();
        if (openInst === inst) {
          openInst = null;
        }
        return;
      }
      if (pop.hidden) {
        return;
      }
      pop.hidden = true;
      cancelAnimationFrame(raf);
      raf = 0;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      inst.filtering = false;
      detach();
      if (openInst === inst) {
        openInst = null;
      }
    }

    function place() {
      // The popup is position:fixed (see css/mmgr.css) so no card, grid or
      // drawer can clip it. Below 640px it becomes a bottom sheet and CSS
      // owns the geometry, so these inline values are cleared.
      var narrow = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
      if (narrow) {
        pop.style.left = '';
        pop.style.top = '';
        pop.style.width = '';
        pop.style.transform = '';
        pop.style.removeProperty('--mmcb-max');
        return;
      }
      var r = input.getBoundingClientRect();
      var below = window.innerHeight - r.bottom >= 240;
      // Never let the portal run off the right edge (a narrow window or a field
      // near the edge). The width still matches the control where it fits.
      var width = Math.min(Math.round(r.width), Math.max(120, window.innerWidth - 16));
      var left = Math.max(8, Math.min(Math.round(r.left), window.innerWidth - width - 8));
      pop.style.left = left + 'px';
      pop.style.width = width + 'px';
      pop.style.top = Math.round(below ? r.bottom + 4 : r.top - 4) + 'px';
      pop.style.transform = below ? 'none' : 'translateY(-100%)';
      var room = Math.max(
        160,
        Math.min(window.innerHeight * 0.6, (below ? window.innerHeight - r.bottom : r.top) - 16)
      );
      pop.style.setProperty('--mmcb-max', Math.round(room) + 'px');
    }

    /* Frame-accurate anchoring. Scroll and resize listeners alone miss a pure
       layout shift (something 120px tall inserted above the field) and can land
       a frame late during smooth or momentum scrolling; one rAF loop per open
       popup re-reads the control and rewrites the portal every frame. */
    function track() {
      if (pop.hidden || !pop.isConnected || !wrap.isConnected) {
        // Nothing left to anchor to (the card re-rendered): stop the loop
        // instead of rewriting geometry on a detached node forever.
        raf = 0;
        return;
      }
      place();
      raf = requestAnimationFrame(track);
    }

    function onScroll() {
      if (!pop.hidden) {
        place();
      }
    }

    function open(withFilter) {
      if (!wrap.isConnected) {
        cancelAnimationFrame(raf);
        raf = 0;
        detach();
        pop.remove();
        if (openInst === inst) {
          openInst = null;
        }
        return;
      }
      if (sel.disabled) {
        return;
      }
      if (openInst && openInst !== inst) {
        openInst.close();
      }
      build(withFilter ? input.value : '');
      place();
      pop.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      openInst = inst;
      document.addEventListener('pointerdown', onDocDown, true);
      window.addEventListener('scroll', onScroll, { passive: true, capture: true });
      window.addEventListener('resize', onScroll, { passive: true });
      if (window.visualViewport) {
        // The mobile keyboard shrinks the visual viewport without a window
        // resize; the sheet has to be told, or it lands under the keyboard.
        window.visualViewport.addEventListener('resize', onScroll);
        window.visualViewport.addEventListener('scroll', onScroll);
      }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(track);
    }

    function pick(row) {
      if (!row) {
        return;
      }
      if (row.getAttribute('aria-disabled') === 'true') {
        return;
      }
      var v = row.getAttribute('data-value');
      sel.value = v;
      // The ONE write the rest of the page needs to see. Bubbling, so the
      // document-level change dispatcher the calculator already uses fires.
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      syncLabel();
      close();
      try {
        input.focus();
      } catch (e) {
        /* focus is a nicety */
      }
    }

    function move(delta) {
      if (pop.hidden) {
        open(false);
      }
      if (!inst.items.length) {
        return;
      }
      var n = inst.items.length;
      inst.active = (inst.active + delta + n) % n;
      paintActive();
    }

    function onDocDown(e) {
      // The portal is not a descendant of the wrapper, so a press inside the
      // list would otherwise read as "outside" and close it before the pick.
      if (!wrap.contains(e.target) && !pop.contains(e.target)) {
        syncLabel();
        close();
      }
    }

    // ---- events ---------------------------------------------------------
    input.addEventListener('focus', function () {
      syncLabel();
      // Select-only behaviour: the value IS the chosen label, and the first
      // keystroke should replace it rather than append to it.
      try {
        input.select();
      } catch (e) {}
    });

    input.addEventListener('click', function () {
      if (pop.hidden) {
        open(false);
      }
    });

    input.addEventListener('input', function () {
      inst.filtering = true;
      open(true);
    });

    input.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowDown' || k === 'Down') {
        e.preventDefault();
        move(1);
        return;
      }
      if (k === 'ArrowUp' || k === 'Up') {
        e.preventDefault();
        move(-1);
        return;
      }
      if (k === 'Home' && !pop.hidden) {
        e.preventDefault();
        inst.active = 0;
        paintActive();
        return;
      }
      if (k === 'End' && !pop.hidden) {
        e.preventDefault();
        inst.active = inst.items.length - 1;
        paintActive();
        return;
      }
      if (k === 'Enter') {
        if (!pop.hidden) {
          e.preventDefault();
          pick(inst.items[inst.active]);
        }
        return;
      }
      if (k === 'Escape') {
        if (!pop.hidden) {
          e.preventDefault();
          syncLabel();
          close();
        }
        return;
      }
      if (k === 'Tab') {
        syncLabel();
        close();
      }
    });

    input.addEventListener('blur', function () {
      // The popup's own rows never take focus (pointerdown picks directly), so
      // a blur means the user left the control: restore the real value.
      setTimeout(function () {
        if (!wrap.contains(document.activeElement)) {
          syncLabel();
          close();
        }
      }, 0);
    });

    btn.addEventListener('pointerdown', function (e) {
      // pointerdown, not click: the input's blur would otherwise race the open.
      e.preventDefault();
      if (pop.hidden) {
        input.focus();
        open(false);
      } else {
        close();
      }
    });

    pop.addEventListener('pointerdown', function (e) {
      var row = e.target.closest ? e.target.closest('[role="option"]') : null;
      if (row) {
        e.preventDefault();
        pick(row);
        return;
      }
      if (e.target.classList && e.target.classList.contains('mmcb-scrim')) {
        e.preventDefault();
        syncLabel();
        close();
      }
    });

    // The page rewrites these lists (the book picker, variants) by replacing
    // options. Rebuild what is on screen and keep the closed label honest.
    if (window.MutationObserver) {
      var mo = new MutationObserver(function () {
        syncLabel();
        if (!pop.hidden) {
          build(inst.filtering ? input.value : '');
        }
      });
      mo.observe(sel, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['disabled']
      });
    }

    // A programmatic `select.value = x` (a recall, a saved estimate, the book
    // picker) must update the visible label too, and it fires no event. The
    // instance keeps the native accessor and adds one sync - reads are
    // untouched, and anything else on the page still sees a real select.
    try {
      var proto = window.HTMLSelectElement && window.HTMLSelectElement.prototype;
      var desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.get && desc.set) {
        Object.defineProperty(sel, 'value', {
          configurable: true,
          enumerable: desc.enumerable,
          get: function () {
            return desc.get.call(sel);
          },
          set: function (v) {
            desc.set.call(sel, v);
            syncLabel();
          }
        });
      }
    } catch (e) {
      /* an older engine: the observer and the change event still cover it */
    }

    // Clicking the page's own <label for> should land in the control, since the
    // select it points at is hidden now.
    var lbl = lblId ? document.getElementById(lblId) : null;
    if (lbl) {
      lbl.addEventListener('click', function (e) {
        if (e.target === lbl || e.target.closest('label') === lbl) {
          e.preventDefault();
          input.focus();
        }
      });
    }

    syncLabel();
    return inst;
  }

  function enhance(sel) {
    if (!sel) {
      return null;
    }
    if (sel.__mmcb) {
      return sel.__mmcb;
    }
    // A re-render path calls enhance again; that is exactly when a popup from
    // the previous markup can be stranded, so clear the ground first.
    sweepOrphans();
    return Enhance(sel);
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function boot() {
    if (!flagOn('comboboxPicker')) {
      return;
    }
    // A fresh document normally has no portal, but a page that restores markup
    // from a snapshot can; never leave one without a control to close it.
    sweepOrphans();
    // The two long lists the directive names: Type of work, Work item. Both
    // carry real families and long labels; the short pickers stay native.
    ['calc-family', 'calc-work'].forEach(function (id) {
      enhance(byId(id));
    });
  }

  ns.Combobox = {
    enhance: enhance,
    refresh: function (idOrEl) {
      var sel = typeof idOrEl === 'string' ? byId(idOrEl) : idOrEl;
      if (sel && sel.__mmcb) {
        sel.__mmcb.input.value = selectedText(sel);
      }
    },
    isEnhanced: function (id) {
      var el = byId(id);
      return !!(el && el.__mmcb);
    },
    // The orphan sweep, exposed so a gate can prove a removed control takes its
    // portal with it (and so a feature can sweep after replacing markup).
    sweep: sweepOrphans
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})((window.MMGR = window.MMGR || {}));
