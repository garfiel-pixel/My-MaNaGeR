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

  function syncSidebarChrome() {
    const on = sidebarEnabled();
    document.body.classList.toggle('sidebar-on', on);
    if (document.body.classList.contains('sidebar-open')) {
      const sb = U.$('app-sidebar');
      if (sb) {
        sb.scrollTop = 0;
      }
    }
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

  function setSidebarOpen(open) {
    document.body.classList.toggle('sidebar-open', !!open);
    syncSidebarChrome();
  }

  function toggleSidebar() {
    _sidebarUserTouched = true;
    const on = !sidebarEnabled();
    writeDevicePref(SIDEBAR_KEY, on ? 'on' : 'off');
    document.body.classList.toggle('sidebar-open', on);
    // I-14: an explicit hamburger toggle pins (or un-pins) the rail. While
    // pinned the hover-to-peek handlers leave it alone.
    _userPinned = on;
    syncSidebarChrome();
    pushSidebarBackend(on);
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
    const zone = document.querySelector('.sb-peek');
    const openPeek = function () {
      if (_userPinned) {
        return;
      }
      clearPeekTimer();
      setSidebarOpen(true);
    };
    const closePeekSoon = function () {
      if (_userPinned) {
        return;
      }
      clearPeekTimer();
      _peekTimer = setTimeout(function () {
        _peekTimer = null;
        if (!_userPinned) {
          setSidebarOpen(false);
        }
      }, 120);
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
      _userPinned = false;
      clearPeekTimer();
      setSidebarOpen(false);
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
          _userPinned = v === 'on';
          document.body.classList.toggle('sidebar-open', v === 'on');
          syncSidebarChrome();
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
    setSidebarOpen: setSidebarOpen,
    toggleSidebar: toggleSidebar,
    pushSidebarBackend: pushSidebarBackend,
    pullSidebarBackend: pullSidebarBackend,
    buildSidebar: buildSidebar
  };
})(MMGR);
