/* ============================================================
   SECTION ACCELERATOR - B9 (audit 2026-11-01)
   ------------------------------------------------------------
   The owner revised B9 away from a new multitasker: it extends the
   EXISTING section navigation with two conveniences, and nothing else.

     1. MOUSE SIDE BUTTONS (button 3 = back, button 4 = forward) step
        one section each way through the existing nav order. They stop
        at the ends (no wrap, no silent no-op confusion - a toast says
        it is the first/last). They NEVER hijack the keyboard arrows, so
        a page still scrolls with the wheel and arrow keys. The browser's
        own back/forward is left untouched unless the feature is ON.

     2. PINS - up to five quick sections, persisted, with a small reset
        that carries no pill chrome. Pinning the sixth is refused.

   OFF by default. Flipped on in the control panel. Per the audit the
   side buttons are the ONLY input - keyboard arrows are never bound.
   ============================================================ */
(function (ns) {
  'use strict';

  const ENABLED_KEY = 'mmgr_sec_accel';
  const PINS_KEY = 'mmgr_sec_pins';
  const MAX_PINS = 5;
  const U = ns.Utils;

  function isEditable(t) {
    if (!t) return false;
    if (t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return true;
    return false;
  }

  function enabled() {
    try {
      return localStorage.getItem(ENABLED_KEY) === '1';
    } catch (e) {
      return false;
    }
  }
  function setEnabled(on) {
    try {
      localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
    } catch (e) {}
  }
  function getPins() {
    try {
      const v = JSON.parse(localStorage.getItem(PINS_KEY) || '[]');
      return Array.isArray(v)
        ? v.filter(function (s) {
            return typeof s === 'string';
          })
        : [];
    } catch (e) {
      return [];
    }
  }
  function setPins(arr) {
    try {
      localStorage.setItem(PINS_KEY, JSON.stringify(arr.slice(0, MAX_PINS)));
    } catch (e) {}
  }

  // The existing nav order, with hidden (is-hide / method-pack-off) sections
  // excluded so the accelerator never lands on a section the owner cannot see.
  function orderedSections() {
    const nav = U.$('sec-nav');
    if (!nav) return [];
    const btns = nav.querySelectorAll('.sec-btn:not(.is-hide)');
    const out = [];
    for (let i = 0; i < btns.length; i++) {
      const id = btns[i].getAttribute('data-section');
      if (id) out.push(id);
    }
    return out;
  }

  function currentSection() {
    const active = document.querySelector('#sec-nav .sec-btn.active');
    if (active) {
      const id = active.getAttribute('data-section');
      if (id) return id;
    }
    const panel = document.querySelector('.panel.active');
    if (panel && panel.id && panel.id.indexOf('panel-') === 0) {
      return panel.id.slice('panel-'.length);
    }
    return null;
  }

  function btnFor(section) {
    return document.querySelector('.sec-btn[data-section="' + section + '"]');
  }

  function go(delta) {
    const order = orderedSections();
    if (!order.length) return;
    const cur = currentSection();
    let idx = cur ? order.indexOf(cur) : -1;
    if (idx < 0) idx = 0;
    const next = idx + delta;
    if (next < 0) {
      if (ns.App && ns.App.showToast) ns.App.showToast('Already at the first section.', 'warn');
      return;
    }
    if (next >= order.length) {
      if (ns.App && ns.App.showToast) ns.App.showToast('Already at the last section.', 'warn');
      return;
    }
    const sec = order[next];
    if (ns.App && ns.App.showSec) ns.App.showSec(sec, btnFor(sec));
  }

  function pinCurrent() {
    const cur = currentSection();
    if (!cur) return;
    const pins = getPins();
    if (pins.indexOf(cur) >= 0) {
      if (ns.App && ns.App.showToast) ns.App.showToast('That section is already pinned.', 'warn');
      return;
    }
    if (pins.length >= MAX_PINS) {
      if (ns.App && ns.App.showToast)
        ns.App.showToast('At most ' + MAX_PINS + ' pinned sections. Reset to add more.', 'warn');
      return;
    }
    pins.push(cur);
    setPins(pins);
    paintPins();
    if (ns.App && ns.App.showToast) ns.App.showToast('Pinned ' + sectionLabel(cur) + '.', 'ok');
  }

  function unpin(sec) {
    const pins = getPins().filter(function (s) {
      return s !== sec;
    });
    setPins(pins);
    paintPins();
  }

  function resetPins() {
    setPins([]);
    paintPins();
    if (ns.App && ns.App.showToast) ns.App.showToast('Pinned sections cleared.', 'ok');
  }

  function sectionLabel(sec) {
    const b = btnFor(sec);
    if (b) {
      const t = b.getAttribute('aria-label') || b.textContent;
      if (t) return t.trim();
    }
    return sec;
  }

  function paintPins() {
    const pins = getPins();
    const wrap = U.$('sec-accel-pins');
    if (wrap) {
      wrap.innerHTML = '';
      pins.forEach(function (sec) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'sec-pin-chip';
        chip.setAttribute('data-action', 'unpinSection');
        chip.setAttribute('data-section', sec);
        chip.setAttribute('aria-label', 'Unpin ' + sectionLabel(sec));
        const label = document.createElement('span');
        label.textContent = sectionLabel(sec);
        const x = document.createElement('span');
        x.className = 'sec-pin-x';
        x.setAttribute('aria-hidden', 'true');
        x.textContent = '×'; // multiplication sign, not an emoji - a close glyph
        chip.appendChild(label);
        chip.appendChild(x);
        chip.addEventListener('click', function () {
          unpin(sec);
        });
        wrap.appendChild(chip);
      });
      const empty = U.$('sec-accel-pins-empty');
      if (empty) empty.classList.toggle('is-hide', pins.length > 0);
    }
    // per-button pinned state (the dot is a sibling of the button, inside
    // .sec-btn-wrap, so the section id comes from the dot's own attribute)
    const all = document.querySelectorAll('#sec-nav .sec-pin-dot');
    for (let i = 0; i < all.length; i++) {
      const sec = all[i].getAttribute('data-section');
      all[i].classList.toggle('on', !!sec && pins.indexOf(sec) >= 0);
    }
  }

  function toggleEnabled(on) {
    setEnabled(on);
    const tgl = U.$('sec-accel-toggle');
    if (tgl) tgl.checked = on;
    if (ns.App && ns.App.showToast)
      ns.App.showToast(on ? 'Section accelerator on.' : 'Section accelerator off.', 'ok');
  }

  // A small pin dot on every section button - clicking it pins/unpins
  // without needing a parallel toolbar. The dot is a SIBLING of the button,
  // never a child: `.sec-btn` is a <button>, and a focusable control inside
  // another button is invalid markup that axe's nested-interactive rule
  // fails on every section (48 nodes, 2026-11-05). The wrapper is what the
  // dot positions itself against.
  function installPinDots() {
    const nav = U.$('sec-nav');
    if (!nav) return;
    const btns = nav.querySelectorAll('.sec-btn[data-section]');
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      let wrap = b.parentElement;
      if (!wrap || !wrap.classList || !wrap.classList.contains('sec-btn-wrap')) {
        wrap = document.createElement('span');
        wrap.className = 'sec-btn-wrap';
        b.parentNode.insertBefore(wrap, b);
        wrap.appendChild(b);
      }
      if (wrap.querySelector('.sec-pin-dot')) continue;
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'sec-pin-dot';
      dot.setAttribute('data-action', 'pinSection');
      dot.setAttribute('data-section', b.getAttribute('data-section'));
      dot.setAttribute('aria-label', 'Pin ' + (b.getAttribute('aria-label') || 'section'));
      dot.setAttribute('title', 'Pin section');
      dot.addEventListener('click', function (e) {
        e.stopPropagation();
        const sec = b.getAttribute('data-section');
        if (getPins().indexOf(sec) >= 0) unpin(sec);
        else pinCurrent();
      });
      wrap.appendChild(dot);
    }
  }

  function bootSectionAccelerator() {
    // Mouse side buttons (back = 3, forward = 4). Only when enabled, and
    // never over an editable field. preventDefault stops the browser's own
    // back/forward so the gesture means "next/previous section" instead.
    document.addEventListener(
      'mouseup',
      function (e) {
        if (!enabled()) return;
        if (isEditable(e.target)) return;
        if (e.button === 3) {
          e.preventDefault();
          go(-1);
        } else if (e.button === 4) {
          e.preventDefault();
          go(1);
        }
      },
      true
    );

    const tgl = U.$('sec-accel-toggle');
    if (tgl) {
      tgl.checked = enabled();
      tgl.addEventListener('change', function () {
        toggleEnabled(!!tgl.checked);
      });
    }
    const pinBtn = U.$('sec-accel-pin');
    if (pinBtn) pinBtn.addEventListener('click', pinCurrent);
    const resetBtn = U.$('sec-accel-reset');
    if (resetBtn) resetBtn.addEventListener('click', resetPins);

    installPinDots();
    paintPins();
  }

  ns.SectionAccelerator = {
    init: bootSectionAccelerator,
    go: go,
    pinCurrent: pinCurrent,
    unpin: unpin,
    resetPins: resetPins,
    toggleEnabled: toggleEnabled,
    enabled: enabled,
    getPins: getPins,
    orderedSections: orderedSections,
    MAX_PINS: MAX_PINS,
    // data-action handlers (pinSection / unpinSection / tglSecAccel)
    pinSection: function (el) {
      const sec = el && el.getAttribute ? el.getAttribute('data-section') : null;
      if (sec) {
        if (getPins().indexOf(sec) >= 0) unpin(sec);
        else pinCurrent();
      } else {
        pinCurrent();
      }
    },
    unpinSection: function (el) {
      const sec = el && el.getAttribute ? el.getAttribute('data-section') : null;
      if (sec) unpin(sec);
    },
    tglSecAccel: function (el) {
      const on = el && el.checked !== undefined ? !!el.checked : !enabled();
      toggleEnabled(on);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootSectionAccelerator);
  } else {
    bootSectionAccelerator();
  }
})((window.MMGR = window.MMGR || {}));
