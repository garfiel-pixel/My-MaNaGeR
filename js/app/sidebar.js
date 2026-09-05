/* ============================================================
   APP SIDEBAR - sidebar chrome, open/close, device pref sync
   ------------------------------------------------------------
   Extracted from mmgr-app.js. Manages the desktop overlay
   sidebar: hamburger toggle, scroll-to-top on open, backend
   pref sync, and the clone-based sidebar builder.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;
  const SIDEBAR_KEY = 'mmgr_sidebar';
  let _sidebarUserTouched = false;

  function readDevicePref(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function writeDevicePref(key, v) { try { localStorage.setItem(key, v); } catch (e) {} }

  function sidebarEnabled() { return true; }

  function syncSidebarChrome() {
    const on = sidebarEnabled();
    document.body.classList.toggle('sidebar-on', on);
    if (document.body.classList.contains('sidebar-open')) {
      const sb = U.$('app-sidebar');
      if (sb) sb.scrollTop = 0;
    }
    const btn = U.$('nav-btn');
    if (btn) {
      const mobile = window.innerWidth <= 768;
      btn.setAttribute('aria-expanded', mobile ? 'false' : (document.body.classList.contains('sidebar-open') ? 'true' : 'false'));
      btn.setAttribute('aria-controls', mobile ? 'sec-nav' : 'app-sidebar');
    }
    const tgl = U.$('sb-tgl');
    if (tgl) tgl.checked = on;
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
    syncSidebarChrome();
    pushSidebarBackend(on);
  }

  function pushSidebarBackend(on) {
    try {
      fetch('/api/cloud/prefs/theme', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sidebar: on ? 'on' : 'off' })
      }).then(function (r) {
        if (r.ok) writeDevicePref('mmgr_palette_backend', '1');
      }).catch(function () { /* offline / no worker, localStorage is the cache */ });
    } catch (e) { /* ignore */ }
  }

  function pullSidebarBackend() {
    if (_sidebarUserTouched) return;
    if (readDevicePref('mmgr_palette_backend') !== '1') return;
    if (readDevicePref(SIDEBAR_KEY) != null) return;
    try {
      fetch('/api/cloud/prefs/theme', { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.ok || !d.theme) return;
          if (_sidebarUserTouched) return;
          const v = d.theme.sidebar;
          if (v !== 'on' && v !== 'off') return;
          writeDevicePref(SIDEBAR_KEY, v);
          document.body.classList.toggle('sidebar-open', v === 'on');
          syncSidebarChrome();
        }).catch(function () { /* backend unreachable, keep local cache */ });
    } catch (e) { /* ignore */ }
  }

  function buildSidebar() {
    const sb = U.$('app-sidebar');
    const nav = U.$('sec-nav');
    if (!sb || !nav) return;
    const groups = nav.querySelectorAll('.nav-group');
    for (let i = 0; i < groups.length; i++) {
      const c = groups[i].cloneNode(true);
      c.querySelectorAll('[id]').forEach(function (el) { el.removeAttribute('id'); });
      sb.appendChild(c);
    }
    const mo = new MutationObserver(function (muts) {
      for (let i = 0; i < muts.length; i++) {
        const m = muts[i];
        if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
        const orig = m.target;
        if (!orig.classList || !orig.classList.contains('sec-btn')) continue;
        const sec = orig.getAttribute('data-section');
        if (!sec) continue;
        const twin = sb.querySelector('.sec-btn[data-section="' + sec + '"]');
        if (twin) twin.classList.toggle('is-hide', orig.classList.contains('is-hide'));
      }
    });
    mo.observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
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
