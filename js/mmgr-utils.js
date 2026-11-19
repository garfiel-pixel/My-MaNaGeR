/* ============================================================
   My MaNaGeR , Utility Functions Module
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  // ---- Date Parsing ----
  function parseDL(str) {
    if (!str) {
      return null;
    }
    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      const parts = str.split('-').map(Number);
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    // DD/MM/YYYY or MM/DD/YYYY , distinguished by magnitude, since the two
    // digit-only patterns are otherwise indistinguishable:
    //   first part > 12  → day-first  (DD/MM/YYYY)  e.g. 15/03/2026
    //   second part > 12 → month-first (MM/DD/YYYY) e.g. 03/15/2026 (US)
    //   both ≤ 12        → ambiguous; documented default is DD/MM/YYYY
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
      const parts = str.split('/').map(Number);
      if (parts[0] > 12) {
        return new Date(parts[2], parts[1] - 1, parts[0]);
      } // DD/MM
      if (parts[1] > 12) {
        return new Date(parts[2], parts[0] - 1, parts[1]);
      } // MM/DD
      return new Date(parts[2], parts[1] - 1, parts[0]); // ambiguous → DD/MM
    }
    // DD-Mon-YYYY
    const months = {
      jan: 0,
      feb: 1,
      mar: 2,
      apr: 3,
      may: 4,
      jun: 5,
      jul: 6,
      aug: 7,
      sep: 8,
      oct: 9,
      nov: 10,
      dec: 11
    };
    const m = str.match(/^(\d{1,2})-([a-zA-Z]{3})-(\d{4})$/);
    if (m) {
      const month = months[m[2].toLowerCase()];
      if (month !== undefined) {
        return new Date(+m[3], month, +m[1]);
      }
    }
    // ISO
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d;
    }
    return null;
  }

  function fmtDate(d) {
    if (!d) {
      return '';
    }
    if (typeof d === 'string') {
      d = parseDL(d);
    }
    if (!d || isNaN(d.getTime())) {
      return '';
    }
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function fmtDateShort(d) {
    if (!d) {
      return '';
    }
    if (typeof d === 'string') {
      d = parseDL(d);
    }
    if (!d || isNaN(d.getTime())) {
      return '';
    }
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec'
    ];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  }

  function daysBetween(a, b) {
    if (!a || !b) {
      return 0;
    }
    if (typeof a === 'string') {
      a = parseDL(a);
    }
    if (typeof b === 'string') {
      b = parseDL(b);
    }
    if (!a || !b || isNaN(a.getTime()) || isNaN(b.getTime())) {
      return 0;
    }
    return Math.round((b - a) / (1000 * 60 * 60 * 24));
  }

  function addDays(d, n) {
    if (typeof d === 'string') {
      d = parseDL(d);
    }
    if (!d || isNaN(d.getTime())) {
      return new Date();
    }
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  function todayStr() {
    return fmtDate(new Date());
  }

  function isOverdue(endDate) {
    if (!endDate) {
      return false;
    }
    const end = parseDL(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return end && end < today;
  }

  function isDueSoon(endDate, days) {
    if (!endDate) {
      return false;
    }
    const end = parseDL(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const limit = addDays(today, days || 3);
    return end && end >= today && end <= limit;
  }

  // ---- Working Days ----
  function getWorkWeek() {
    const s = ns.State ? ns.State.getState() : null;
    return (s && s.workWeek) || 5;
  }

  // Is this calendar day a working day under the given work week?
  // workWeek = days worked per week: 5 → Mon-Fri, 6 → Mon-Sat, 7 → every day.
  function isWorkDay(d, workWeek) {
    if (typeof d === 'string') {
      d = parseDL(d);
    }
    if (!d || isNaN(d.getTime())) {
      return false;
    }
    // Same fallback as the other working-day helpers: state-driven, 5 if none.
    const ww = parseInt(workWeek) || getWorkWeek();
    if (ww >= 7) {
      return true;
    }
    const dow = d.getDay(); // 0 = Sunday
    return dow >= 1 && dow <= ww;
  }

  // Advance n WORKING days from d (n may be negative). Skips non-working
  // days per the configured work week. Used for all duration arithmetic so
  // the work-week control actually drives cascade, Gantt bars, and float.
  function addWorkingDays(d, n, workWeek) {
    if (typeof d === 'string') {
      d = parseDL(d);
    }
    if (!d || isNaN(d.getTime())) {
      return new Date();
    }
    const ww = parseInt(workWeek) || getWorkWeek();
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    let steps = Math.abs(n);
    const dir = n >= 0 ? 1 : -1;
    while (steps > 0) {
      r.setDate(r.getDate() + dir);
      if (isWorkDay(r, ww)) {
        steps--;
      }
    }
    return r;
  }

  // Number of WORKING days strictly between a and b (positive when b is
  // after a, negative otherwise). The float math mirrors calendar daysBetween
  // but counts only the days the crew actually works.
  function workingDaysBetween(a, b, workWeek) {
    if (!a || !b) {
      return 0;
    }
    if (typeof a === 'string') {
      a = parseDL(a);
    }
    if (typeof b === 'string') {
      b = parseDL(b);
    }
    if (!a || !b || isNaN(a.getTime()) || isNaN(b.getTime())) {
      return 0;
    }
    const ww = parseInt(workWeek) || getWorkWeek();
    const forward = a <= b;
    const lo = forward ? a : b;
    const hi = forward ? b : a;
    let count = 0;
    const cur = new Date(lo);
    cur.setHours(0, 0, 0, 0);
    cur.setDate(cur.getDate() + 1);
    while (cur < hi) {
      if (isWorkDay(cur, ww)) {
        count++;
      }
      cur.setDate(cur.getDate() + 1);
    }
    return forward ? count : -count;
  }

  // ---- ID Generation ----
  let _idCounter = 0;
  function genId(prefix) {
    _idCounter++;
    return (prefix || 't') + '_' + Date.now().toString(36) + '_' + _idCounter;
  }

  function genShortId(prefix) {
    _idCounter++;
    return (prefix || 'x') + String(_idCounter).padStart(3, '0');
  }

  // ---- Hashing (for access codes) ----
  async function sha256(str) {
    const buf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(str.trim().toUpperCase())
    );
    return Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // ---- DOM Helpers ----
  function $(id) {
    return document.getElementById(id);
  }

  // S-5 (audit 2026-10-18): attribute-SAFE. The textContent trick escapes
  // & < > but NOT quotes, so a value carrying a quote could close the
  // attribute it lands in (value="${name}" with name = " onfocus="x).
  // Escaping " and ' as well makes ONE escaper safe in text position and
  // in attribute position, which is where most of the app puts user text
  // (values, titles, data-ids). Rendered output is unchanged - &quot;
  // and &#39; decode back to the original character.
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function show(id) {
    const el = $(id);
    if (el) {
      el.classList.remove('is-hide');
    }
  }

  function hide(id) {
    const el = $(id);
    if (el) {
      el.classList.add('is-hide');
    }
  }

  function toggle(id) {
    const el = $(id);
    if (el) {
      el.classList.toggle('is-hide');
    }
  }

  // ---- Debounce ----
  function debounce(fn, ms) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms || 200);
    };
  }

  // ---- Throttle ----
  function throttle(fn, ms) {
    let last = 0;
    return function (...args) {
      const now = Date.now();
      if (now - last >= (ms || 100)) {
        last = now;
        fn.apply(this, args);
      }
    };
  }

  // ---- Sanitize ----
  function sanitize(str) {
    if (!str) {
      return '';
    }
    // Strip until stable: a single pass can leave a new tag behind when
    // removing one tag joins its neighbours into another.
    let out = String(str);
    let prev;
    do {
      prev = out;
      out = out.replace(/<[^>]*>/g, '');
    } while (out !== prev);
    return out.trim();
  }

  // ---- Copy to Clipboard ----
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    }
  }

  // ---- Focus-preserving re-render (browser-verified) ----
  // Defer a table re-render until focus has settled (a `change` event fires
  // while document.activeElement is still BODY, because the next field has not
  // received focus yet). If we re-render synchronously we destroy the input
  // the user is about to click/type into and focus is lost. This helper:
  //  1. waits one tick so the browser can finish the focus transition
  //  2. snapshots the focused editable element (action + id/field/id x locators)
  //  3. runs the render callback
  //  4. restores focus + caret on the re-rendered twin of that same field
  function rerenderPreservingFocus(renderFn) {
    setTimeout(function () {
      const ae = document.activeElement;
      let rec = null;
      if (ae && ae.getAttribute && ae.getAttribute('data-action') && ae !== document.body) {
        rec = {
          action: ae.getAttribute('data-action'),
          id: ae.getAttribute('data-id'),
          field: ae.getAttribute('data-field'),
          idx: ae.getAttribute('data-idx'),
          selStart: typeof ae.selectionStart === 'number' ? ae.selectionStart : null,
          selEnd: typeof ae.selectionEnd === 'number' ? ae.selectionEnd : null
        };
      }
      renderFn();
      if (rec && rec.action) {
        let sel = '[data-action="' + rec.action + '"]';
        if (rec.id != null) {
          sel += '[data-id="' + rec.id + '"]';
        }
        if (rec.field != null) {
          sel += '[data-field="' + rec.field + '"]';
        }
        if (rec.idx != null) {
          sel += '[data-idx="' + rec.idx + '"]';
        }
        const el = document.querySelector(sel);
        if (el && el !== document.activeElement) {
          // Defensive guard: native picker inputs (date/time/month/week/
          // datetime-local) re-open their popup the moment they gain focus in
          // Chrome. Never force focus back onto a picker-type input , that
          // would pop the picker back open (the "dates are fighting me" bug).
          // Callers already skip rebuilding the WBS row when a date input has
          // focus (see updTaskField), so this is belt-and-suspenders for any
          // future caller that re-renders a table containing date inputs.
          const pickerType =
            el.type === 'date' ||
            el.type === 'time' ||
            el.type === 'month' ||
            el.type === 'week' ||
            el.type === 'datetime-local';
          if (!pickerType) {
            try {
              el.focus();
            } catch (e) {}
          }
          if (el.setSelectionRange && rec.selStart != null && el.type === 'text') {
            try {
              el.setSelectionRange(rec.selStart, rec.selEnd);
            } catch (e2) {}
          }
        }
      }
    }, 0);
  }

  /* SW-12 (REFINEMENT-DIRECTIVE-2026-10-24 section 11): ONE currency table.
     Every money figure prints its symbol from here, so no string in the app
     types a '$' or 'J$' of its own. Default stays USD, exactly the output
     this formatter produced before the table existed. */
  const CURRENCY = {
    USD: '$',
    JMD: 'J$'
  };

  function fmtMoney(n, code) {
    const sym = CURRENCY[String(code || 'USD').toUpperCase()] || CURRENCY.USD;
    return n != null ? sym + Number(n).toLocaleString() : sym + '0';
  }

  // ---- API ----
  ns.Utils = {
    parseDL: parseDL,
    fmtDate: fmtDate,
    fmtDateShort: fmtDateShort,
    daysBetween: daysBetween,
    addDays: addDays,
    isWorkDay: isWorkDay,
    addWorkingDays: addWorkingDays,
    workingDaysBetween: workingDaysBetween,
    todayStr: todayStr,
    isOverdue: isOverdue,
    isDueSoon: isDueSoon,
    getWorkWeek: getWorkWeek,
    genId: genId,
    genShortId: genShortId,
    sha256: sha256,
    $: $,
    escapeHtml: escapeHtml,
    show: show,
    hide: hide,
    toggle: toggle,
    debounce: debounce,
    throttle: throttle,
    rerenderPreservingFocus: rerenderPreservingFocus,
    sanitize: sanitize,
    copyToClipboard: copyToClipboard,

    /* BUG #1: safe JSON.parse - prevents app crash on corrupt localStorage */
    safeParse: function (raw, fallback) {
      if (fallback === undefined) {
        fallback = null;
      }
      try {
        return JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },

    /* BUG #3: truncate list with overflow indicator */
    truncateList: function (arr, limit, fmt) {
      if (!arr || !arr.length) {
        return '';
      }
      var shown = arr.slice(0, limit).map(
        fmt ||
          function (x) {
            return String(x);
          }
      );
      var hidden = Math.max(0, arr.length - limit);
      var result = shown.join('; ');
      return hidden > 0 ? result + ' (and ' + hidden + ' more)' : result;
    },

    /* BUG #7: time constants - single source of truth for ms/day */
    MS_PER_DAY: 86400000,

    fmtDateLocal: function (d) {
      d = d instanceof Date ? d : new Date(d);
      return isNaN(d)
        ? ''
        : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    },
    /* SW-12 (REFINEMENT-DIRECTIVE-2026-10-24 section 11): the symbol comes
       from ONE currency table, never typed into a string. The workspace's own
       figures are US dollars; pass a code to print another currency. */
    fmtMoney: fmtMoney,
    CURRENCY: CURRENCY
  };

  /* APP-2 (REFINEMENT-DIRECTIVE-2026-10-24): ONE navigation helper.
     Owner rule (question 9, default yes): the core app pages - the dashboard,
     the admin panel, a project and the calculator - always navigate in the
     SAME tab, so one session is one tab. A new tab is for an external site, a
     checkout, the field guide or a file, and for a real link the user chose to
     open in a new tab (middle-click / Ctrl-click still work on any <a href>).

     A helper rather than a scattered rule: a new feature calls go() and gets
     the same behaviour, and the T-NEWTAB gate has one place to allow.

     UX-2026-11-19 B5: the SAME helper now also moves WITHIN the workspace.
     go({panel, recordId, filter}) switches the panel, applies an optional
     view filter, scrolls the record into view and flashes it. One helper for
     both jobs, because a second navigator would drift from this one.

     History: every panel switch is an entry (the dashboard is the entry the
     project opened on), so the browser and phone back gesture returns to the
     dashboard with its scroll position restored. The hash carries the panel
     name (#wbs) - the only hash convention in this app - so a deep link
     works and an <a href="#wbs"> still works if this module never loads. */
  var NAV_SECTIONS = {
    dash: 1,
    def: 1,
    wbs: 1,
    gantt: 1,
    kan: 1,
    ideas: 1,
    agenda: 1,
    risk: 1,
    res: 1,
    bud: 1,
    stk: 1,
    chg: 1,
    log: 1,
    close: 1,
    raci: 1,
    comms: 1,
    docs: 1,
    proc: 1,
    dmaic: 1,
    meet: 1,
    charter: 1,
    claim: 1,
    photos: 1
  };
  var navReady = false;
  var navSuppress = 0;

  function navPanel() {
    var active = document.querySelector('.panel.active');
    if (!active || !active.id || active.id.indexOf('panel-') !== 0) {
      return 'dash';
    }
    return active.id.slice(6);
  }

  function navSectionFromHash(hash) {
    var h = String(hash || '')
      .replace(/^#/, '')
      .split(/[/?]/)[0]
      .toLowerCase();
    return NAV_SECTIONS[h] ? h : '';
  }

  function navReduced() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  function navShow(panel) {
    var R = ns.Render;
    if (!R || typeof R.showSection !== 'function') {
      return false;
    }
    var btn = document.querySelector('.sec-btn[data-section="' + panel + '"]');
    R.showSection(panel, btn, { history: false });
    return true;
  }

  // A one-line notice where the record would have been. The panel still
  // renders - a dead link must never leave the user on a blank screen.
  function navMiss(panel, label) {
    var host = document.getElementById('panel-' + panel);
    if (!host) {
      return;
    }
    var old = host.querySelector('.nav-miss');
    if (old && old.parentNode) {
      old.parentNode.removeChild(old);
    }
    var el = document.createElement('div');
    el.className = 'nav-miss';
    el.setAttribute('role', 'status');
    el.textContent = (label ? label + ' is' : 'That record is') + ' no longer in this project.';
    host.insertBefore(el, host.firstChild);
    window.setTimeout(function () {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }, 6000);
  }

  function navFlash(hit) {
    if (!hit) {
      return;
    }
    // The agenda's own flash: one pulse for the whole app, not a second one.
    hit.classList.add('ag-hit');
    if (typeof hit.scrollIntoView === 'function') {
      hit.scrollIntoView({ block: 'center', behavior: navReduced() ? 'auto' : 'smooth' });
    }
    if (!hit.hasAttribute('tabindex')) {
      hit.setAttribute('tabindex', '-1');
    }
    if (typeof hit.focus === 'function') {
      try {
        hit.focus({ preventScroll: true });
      } catch (e) {
        /* focus is a nicety, never a failure */
      }
    }
    window.setTimeout(function () {
      hit.classList.remove('ag-hit');
    }, 1600);
  }

  function navFocus(panel, wanted) {
    var id = String(wanted);
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        var root = document.getElementById('panel-' + panel) || document;
        var nodes = root.querySelectorAll('[data-id], [data-idea-id], [data-idx]');
        for (var i = 0; i < nodes.length; i += 1) {
          var el = nodes[i];
          if (
            el.getAttribute('data-id') === id ||
            el.getAttribute('data-idea-id') === id ||
            el.getAttribute('data-idx') === id
          ) {
            navFlash(el);
            return;
          }
        }
        navMiss(panel);
      });
    });
  }

  function navColumn(panel, name) {
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        var root = document.getElementById('panel-' + panel) || document;
        // The board names its columns col-todo / col-ip / col-bl / col-dn;
        // the drop status is the honest key, the id is the fallback.
        var col =
          root.querySelector('[data-drop-status="' + name + '"]') ||
          root.querySelector('[data-col="' + name + '"]') ||
          document.getElementById('col-' + name);
        if (!col) {
          navMiss(panel);
          return;
        }
        navFlash(col);
      });
    });
  }

  // An anchor is a card that is its own destination (the EVM view, the
  // weather log). It lives on a panel that is already the right place, so
  // the helper scrolls to it and flashes it exactly like a record.
  function navAnchor(panel, name) {
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        var root = document.getElementById('panel-' + panel) || document;
        var el = root.querySelector('[data-nav-anchor="' + name + '"]');
        if (!el) {
          navMiss(panel);
          return;
        }
        navFlash(el);
      });
    });
  }

  function navFilter(panel, filter) {
    var R = ns.Render;
    if (panel === 'wbs' && R && typeof R.setWbsFilter === 'function') {
      R.setWbsFilter(filter || '');
    }
  }

  function navRememberCurrent(panel) {
    try {
      var st = window.history.state;
      var prev = st && st.mmgrNav ? st : { mmgrNav: 1, panel: panel };
      prev.scrollY = window.scrollY;
      window.history.replaceState(prev, '');
    } catch (e) {
      /* a history entry is a nicety; never block the switch */
    }
  }

  function navPush(panel, req) {
    var state = {
      mmgrNav: 1,
      panel: panel,
      scrollY: 0,
      filter: (req && req.filter) || '',
      recordId: (req && req.recordId) || '',
      column: (req && req.column) || ''
    };
    try {
      if (req && req.replace) {
        window.history.replaceState(state, '', '#' + panel);
      } else {
        window.history.pushState(state, '', '#' + panel);
      }
    } catch (e) {
      /* file:// or a sandboxed frame: the panel still switches */
    }
  }

  function navGoPanel(req) {
    var panel = String(req.panel || '').toLowerCase();
    if (!NAV_SECTIONS[panel]) {
      return false;
    }
    if (navReady && req.history !== false) {
      navRememberCurrent(panel);
      navPush(panel, req);
    }
    // The filter is view state: set it BEFORE the panel renders so the first
    // paint is already the filtered list (no flash of everything).
    navSuppress += 1;
    try {
      navFilter(panel, req.filter);
      navShow(panel);
    } finally {
      navSuppress -= 1;
    }
    if (req.recordId) {
      navFocus(panel, req.recordId);
    } else if (req.column) {
      navColumn(panel, req.column);
    } else if (req.anchor) {
      navAnchor(panel, req.anchor);
    } else {
      window.scrollTo(0, 0);
    }
    return true;
  }

  ns.Nav = {
    isExternal: function (url) {
      return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(String(url || ''));
    },
    go: function (url, opts) {
      if (url && typeof url === 'object') {
        return navGoPanel(url);
      }
      opts = opts || {};
      var u = String(url || '');
      if (!u) {
        return false;
      }
      if (opts.external === true || ns.Nav.isExternal(u)) {
        // noopener: the opened page never gets a handle on this one.
        window.open(u, opts.name || '_blank', 'noopener,noreferrer');
        return true;
      }
      window.location.assign(u);
      return true;
    },
    // Called by Render.showSection at the end of every switch, so a click on
    // the sidebar is a history entry too (not only a go() call).
    sectionShown: function (section) {
      if (!navReady || navSuppress > 0) {
        return;
      }
      var st = window.history.state;
      var prev = st && st.mmgrNav ? st.panel : 'dash';
      if (prev === section) {
        return;
      }
      try {
        window.history.replaceState({ mmgrNav: 1, panel: prev, scrollY: window.scrollY }, '');
      } catch (e) {}
      navPush(section, {});
    },
    // Boot: seed the entry the project opened on, then honour a #panel deep
    // link without leaving a duplicate entry behind.
    start: function () {
      navReady = true;
      var deep = navSectionFromHash(window.location.hash);
      try {
        window.history.replaceState({ mmgrNav: 1, panel: 'dash', scrollY: 0 }, '');
      } catch (e) {}
      if (deep && deep !== 'dash') {
        navGoPanel({ panel: deep, history: false });
      }
    },
    // The dashboard reads this to know whether it is the entry to return to.
    panel: navPanel,
    sections: NAV_SECTIONS,
    fromHash: navSectionFromHash
  };

  window.addEventListener('popstate', function (e) {
    var st = e.state;
    if (!st || !st.mmgrNav || !NAV_SECTIONS[st.panel]) {
      return;
    }
    navSuppress += 1;
    try {
      navFilter(st.panel, st.filter);
      navShow(st.panel);
    } finally {
      navSuppress -= 1;
    }
    // showSection scrolls to the top; the entry's own position wins.
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        if (st.scrollY) {
          window.scrollTo(0, st.scrollY);
        }
      });
    });
  });

  // A typed hash, or an <a href="#wbs"> the click handler never saw.
  window.addEventListener('hashchange', function () {
    if (!navReady) {
      return;
    }
    var h = navSectionFromHash(window.location.hash);
    if (!h || h === navPanel()) {
      return;
    }
    navGoPanel({ panel: h, history: false });
  });
})(MMGR);
window.MMGR = MMGR;
