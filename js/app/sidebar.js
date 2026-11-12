/* ============================================================
   APP SIDEBAR - sidebar chrome, open/close, device pref sync
   ------------------------------------------------------------
   Extracted from mmgr-app.js. Manages the desktop overlay
   sidebar: hamburger toggle, scroll-to-top on open, backend
   pref sync, and the clone-based sidebar builder.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const U = ns.Utils;
  const SIDEBAR_KEY = 'mmgr_sidebar';
  let _sidebarUserTouched = false;
  // I-14 (owner 2026-11-08): when the hamburger pins the rail fully open the
  // hover-to-peek behaviour must NOT auto-collapse it. Tracks that explicit
  // pin; hover/focus only open/close while this is false. OWNER 2026-11-10:
  // the pin is restored from the stored pref on boot, so a pinned rail stays
  // pinned instead of collapsing on the first pointerleave.
  let _userPinned = readDevicePref(SIDEBAR_KEY) === 'on';
  let _wired = false;
  let _peekTimer = null;

  function readDevicePref(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function writeDevicePref(key, v) {
    try {
      localStorage.setItem(key, v);
    } catch (e) {}
  }

  function sidebarEnabled() {
    return true;
  }

  function sidebarIsOpen() {
    return document.body.classList.contains('sidebar-open');
  }

  // OWNER 2026-11-11: the rail's scroll is NOT reset here. This function is a
  // chrome sync (it runs on resize, backend pref pull and every open/close),
  // so resetting scroll here yanked a scrolled rail back to Dashboard while a
  // click was still in flight - the press landed on whatever row moved under
  // the pointer. Scroll is reset only on a genuine closed -> open transition.
  function resetRailScroll() {
    const sb = U.$('app-sidebar');
    if (sb) {
      sb.scrollTop = 0;
    }
  }

  function syncSidebarChrome() {
    const on = sidebarEnabled();
    document.body.classList.toggle('sidebar-on', on);
    const btn = U.$('nav-btn');
    if (btn) {
      const mobile = window.innerWidth <= 768;
      btn.setAttribute(
        'aria-expanded',
        mobile ? 'false' : document.body.classList.contains('sidebar-open') ? 'true' : 'false'
      );
      btn.setAttribute('aria-controls', mobile ? 'sec-nav' : 'app-sidebar');
    }
    const tgl = U.$('sb-tgl');
    if (tgl) {
      tgl.checked = on;
    }
  }

  // opts.pin     - this open/close is an explicit user choice (hamburger,
  //                close button, scrim, Escape), so it pins/unpins the rail.
  // opts.resetScroll (default true on a fresh open) - move the rail to the
  //                top. Hover-peek passes false so a glance never loses the
  //                owner's place.
  function setSidebarOpen(open, opts) {
    const next = !!open;
    const was = sidebarIsOpen();
    const o = opts || {};
    if (o.pin) {
      _userPinned = next;
    }
    document.body.classList.toggle('sidebar-open', next);
    if (next && !was && o.resetScroll !== false) {
      resetRailScroll();
    }
    syncSidebarChrome();
  }

  // Explicit hamburger toggle: pins the rail open (or unpins + closes it) and
  // remembers the choice. `sidebarEnabled()` is always true, so the old
  // `!sidebarEnabled()` made this a permanent close - it could never open.
  function toggleSidebar() {
    _sidebarUserTouched = true;
    const on = !sidebarIsOpen();
    clearPeekTimer();
    writeDevicePref(SIDEBAR_KEY, on ? 'on' : 'off');
    setSidebarOpen(on, { pin: true });
    pushSidebarBackend(on);
  }

  // Close from Escape / scrim / the rail's own close button: unpin too, or a
  // pinned rail would reopen on the next boot and ignore hover-peek.
  function closeSidebar() {
    _sidebarUserTouched = true;
    clearPeekTimer();
    if (readDevicePref(SIDEBAR_KEY) != null) {
      writeDevicePref(SIDEBAR_KEY, 'off');
    }
    setSidebarOpen(false, { pin: true });
  }

  // I-14 (owner 2026-11-08): hover / keyboard focus peeks the collapsed rail
  // open; leaving collapses it back. Desktop + fine pointer only - touch
  // and mobile keep the tap/hamburger drawer pattern untouched.
  // OWNER 2026-11-10: the rail is now fully off-canvas when collapsed, so the
  // hover target is the transparent 12px .sb-peek edge zone, not a 56px icon
  // strip. A 120ms grace lets the pointer cross the gap between the zone and
  // the sliding rail without flicker.
  function clearPeekTimer() {
    if (_peekTimer) {
      clearTimeout(_peekTimer);
      _peekTimer = null;
    }
  }
  // The peek zone is hidden the moment the rail opens, so the pointer that
  // just opened it reports a leave and used to schedule a close 120ms later -
  // which hid the rail, showed the zone again and re-entered: the rail flapped
  // open/closed under a resting pointer. Track the pointer and treat "still
  // over the open rail" as inside.
  // The first-project tour pins the rail open for its section cards; the
  // pointer then rests on the tour card, not the rail, so the peek's
  // pointerleave must not collapse it mid-walk.
  function tourHoldsRail() {
    return document.body.classList.contains('tour-open');
  }
  function closePeekSoon() {
    if (_userPinned || tourHoldsRail()) {
      return;
    }
    clearPeekTimer();
    _peekTimer = setTimeout(function () {
      _peekTimer = null;
      if (!_userPinned && !pointerOverRail()) {
        setSidebarOpen(false);
      }
    }, 120);
  }
  let _ptr = null;
  function trackPointer() {
    document.addEventListener(
      'pointermove',
      function (e) {
        _ptr = { x: e.clientX, y: e.clientY };
        // A rail that appeared under a stationary pointer never received a
        // pointerenter, so it can never receive the matching pointerleave.
        // Any move that is neither over the rail nor over the edge zone
        // means the peek is over - close it on the same 120ms grace.
        if (!_userPinned && sidebarIsOpen() && !pointerOverRail()) {
          closePeekSoon();
        }
      },
      { passive: true }
    );
  }
  function pointerOverRail() {
    if (!_ptr) {
      return false;
    }
    const sb = U.$('app-sidebar');
    if (!sb) {
      return false;
    }
    const r = sb.getBoundingClientRect();
    return _ptr.x >= r.left && _ptr.x <= r.right && _ptr.y >= r.top && _ptr.y <= r.bottom;
  }
  function wireInteractions() {
    if (_wired) {
      return;
    }
    _wired = true;
    const sb = U.$('app-sidebar');
    if (!sb) {
      return;
    }
    const desktop =
      window.matchMedia && window.matchMedia('(min-width: 769px) and (pointer: fine)');
    if (!desktop || !desktop.matches) {
      return;
    }
    trackPointer();
    const zone = document.querySelector('.sb-peek');
    const openPeek = function () {
      if (_userPinned || tourHoldsRail() || sidebarIsOpen()) {
        return;
      }
      clearPeekTimer();
      setSidebarOpen(true, { resetScroll: false });
    };
    if (zone) {
      zone.addEventListener('pointerenter', openPeek);
      zone.addEventListener('pointerleave', closePeekSoon);
    }
    sb.addEventListener('pointerenter', openPeek);
    sb.addEventListener('pointerleave', closePeekSoon);
    sb.addEventListener('focusin', openPeek);
    sb.addEventListener('focusout', function (e) {
      if (!_userPinned && !(e.relatedTarget && sb.contains(e.relatedTarget))) {
        setSidebarOpen(false);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') {
        return;
      }
      if (!document.body.classList.contains('sidebar-open')) {
        return;
      }
      closeSidebar();
    });
  }

  function pushSidebarBackend(on) {
    try {
      fetch('/api/cloud/prefs/theme', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sidebar: on ? 'on' : 'off' })
      })
        .then(function (r) {
          if (r.ok) {
            writeDevicePref('mmgr_sidebar_backend', '1');
          }
        })
        .catch(function () {
          /* offline / no worker, localStorage is the cache */
        });
    } catch (e) {
      /* ignore */
    }
  }

  function pullSidebarBackend() {
    if (_sidebarUserTouched) {
      return;
    }
    if (readDevicePref('mmgr_sidebar_backend') !== '1') {
      return;
    }
    if (readDevicePref(SIDEBAR_KEY) != null) {
      return;
    }
    try {
      fetch('/api/cloud/prefs/theme', { headers: { Accept: 'application/json' } })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (d) {
          if (!d || !d.ok || !d.theme) {
            return;
          }
          if (_sidebarUserTouched) {
            return;
          }
          const v = d.theme.sidebar;
          if (v !== 'on' && v !== 'off') {
            return;
          }
          writeDevicePref(SIDEBAR_KEY, v);
          setSidebarOpen(v === 'on', { pin: true });
        })
        .catch(function () {
          /* backend unreachable, keep local cache */
        });
    } catch (e) {
      /* ignore */
    }
  }

  function buildSidebar() {
    const sb = U.$('app-sidebar');
    const nav = U.$('sec-nav');
    if (!sb || !nav) {
      return;
    }
    const groups = nav.querySelectorAll('.nav-group');
    for (let i = 0; i < groups.length; i++) {
      const c = groups[i].cloneNode(true);
      c.querySelectorAll('[id]').forEach(function (el) {
        el.removeAttribute('id');
      });
      sb.appendChild(c);
    }
    const mo = new MutationObserver(function (muts) {
      for (let i = 0; i < muts.length; i++) {
        const m = muts[i];
        if (m.type !== 'attributes' || m.attributeName !== 'class') {
          continue;
        }
        const orig = m.target;
        if (!orig.classList || !orig.classList.contains('sec-btn')) {
          continue;
        }
        const sec = orig.getAttribute('data-section');
        if (!sec) {
          continue;
        }
        const twin = sb.querySelector('.sec-btn[data-section="' + sec + '"]');
        if (twin) {
          twin.classList.toggle('is-hide', orig.classList.contains('is-hide'));
        }
      }
    });
    mo.observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
    // OWNER 2026-11-10: restore the pinned choice on boot. The rail no longer
    // opens itself; only a stored 'on' pins it.
    if (_userPinned) {
      document.body.classList.add('sidebar-open');
    }
    wireInteractions();
  }

  // ---- Export on ns.AppSidebar ----
  ns.AppSidebar = {
    readDevicePref: readDevicePref,
    writeDevicePref: writeDevicePref,
    syncSidebarChrome: syncSidebarChrome,
    isSidebarOpen: sidebarIsOpen,
    setSidebarOpen: setSidebarOpen,
    toggleSidebar: toggleSidebar,
    closeSidebar: closeSidebar,
    pushSidebarBackend: pushSidebarBackend,
    pullSidebarBackend: pullSidebarBackend,
    buildSidebar: buildSidebar
  };
})(MMGR);
