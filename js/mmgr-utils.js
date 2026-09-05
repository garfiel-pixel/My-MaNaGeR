/* ============================================================
   My MaNaGeR , Utility Functions Module
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  // ---- Date Parsing ----
  function parseDL(str) {
    if (!str) return null;
    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      const parts = str.split('-').map(Number);
      return new Date(parts[0], parts[1]-1, parts[2]);
    }
    // DD/MM/YYYY or MM/DD/YYYY , distinguished by magnitude, since the two
    // digit-only patterns are otherwise indistinguishable:
    //   first part > 12  → day-first  (DD/MM/YYYY)  e.g. 15/03/2026
    //   second part > 12 → month-first (MM/DD/YYYY) e.g. 03/15/2026 (US)
    //   both ≤ 12        → ambiguous; documented default is DD/MM/YYYY
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
      const parts = str.split('/').map(Number);
      if (parts[0] > 12) return new Date(parts[2], parts[1]-1, parts[0]);  // DD/MM
      if (parts[1] > 12) return new Date(parts[2], parts[0]-1, parts[1]);  // MM/DD
      return new Date(parts[2], parts[1]-1, parts[0]);                     // ambiguous → DD/MM
    }
    // DD-Mon-YYYY
    const months = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
    const m = str.match(/^(\d{1,2})-([a-zA-Z]{3})-(\d{4})$/);
    if (m) {
      const month = months[m[2].toLowerCase()];
      if (month !== undefined) return new Date(+m[3], month, +m[1]);
    }
    // ISO
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d;
    return null;
  }

  function fmtDate(d) {
    if (!d) return '';
    if (typeof d === 'string') d = parseDL(d);
    if (!d || isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }

  function fmtDateShort(d) {
    if (!d) return '';
    if (typeof d === 'string') d = parseDL(d);
    if (!d || isNaN(d.getTime())) return '';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${d.getDate()} ${months[d.getMonth()]}`;
  }

  function daysBetween(a, b) {
    if (!a || !b) return 0;
    if (typeof a === 'string') a = parseDL(a);
    if (typeof b === 'string') b = parseDL(b);
    if (!a || !b || isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
    return Math.round((b - a) / (1000 * 60 * 60 * 24));
  }

  function addDays(d, n) {
    if (typeof d === 'string') d = parseDL(d);
    if (!d || isNaN(d.getTime())) return new Date();
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  function todayStr() {
    return fmtDate(new Date());
  }

  function isOverdue(endDate) {
    if (!endDate) return false;
    const end = parseDL(endDate);
    const today = new Date();
    today.setHours(0,0,0,0);
    return end && end < today;
  }

  function isDueSoon(endDate, days) {
    if (!endDate) return false;
    const end = parseDL(endDate);
    const today = new Date();
    today.setHours(0,0,0,0);
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
    if (typeof d === 'string') d = parseDL(d);
    if (!d || isNaN(d.getTime())) return false;
    // Same fallback as the other working-day helpers: state-driven, 5 if none.
    const ww = parseInt(workWeek) || getWorkWeek();
    if (ww >= 7) return true;
    const dow = d.getDay(); // 0 = Sunday
    return dow >= 1 && dow <= ww;
  }

  // Advance n WORKING days from d (n may be negative). Skips non-working
  // days per the configured work week. Used for all duration arithmetic so
  // the work-week control actually drives cascade, Gantt bars, and float.
  function addWorkingDays(d, n, workWeek) {
    if (typeof d === 'string') d = parseDL(d);
    if (!d || isNaN(d.getTime())) return new Date();
    const ww = parseInt(workWeek) || getWorkWeek();
    const r = new Date(d);
    r.setHours(0,0,0,0);
    let steps = Math.abs(n);
    const dir = n >= 0 ? 1 : -1;
    while (steps > 0) {
      r.setDate(r.getDate() + dir);
      if (isWorkDay(r, ww)) steps--;
    }
    return r;
  }

  // Number of WORKING days strictly between a and b (positive when b is
  // after a, negative otherwise). The float math mirrors calendar daysBetween
  // but counts only the days the crew actually works.
  function workingDaysBetween(a, b, workWeek) {
    if (!a || !b) return 0;
    if (typeof a === 'string') a = parseDL(a);
    if (typeof b === 'string') b = parseDL(b);
    if (!a || !b || isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
    const ww = parseInt(workWeek) || getWorkWeek();
    const forward = a <= b;
    const lo = forward ? a : b;
    const hi = forward ? b : a;
    let count = 0;
    const cur = new Date(lo);
    cur.setHours(0,0,0,0);
    cur.setDate(cur.getDate() + 1);
    while (cur < hi) {
      if (isWorkDay(cur, ww)) count++;
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
    return (prefix || 'x') + String(_idCounter).padStart(3,'0');
  }

  // ---- Hashing (for access codes) ----
  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str.trim().toUpperCase()));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  // ---- DOM Helpers ----
  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  function show(id) {
    const el = $(id);
    if (el) el.classList.remove('is-hide');
  }

  function hide(id) {
    const el = $(id);
    if (el) el.classList.add('is-hide');
  }

  function toggle(id) {
    const el = $(id);
    if (el) el.classList.toggle('is-hide');
  }

  // ---- Debounce ----
  function debounce(fn, ms) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms || 200);
    };
  }

  // ---- Throttle ----
  function throttle(fn, ms) {
    let last = 0;
    return function(...args) {
      const now = Date.now();
      if (now - last >= (ms || 100)) {
        last = now;
        fn.apply(this, args);
      }
    };
  }

  // ---- Sanitize ----
  function sanitize(str) {
    if (!str) return '';
    return String(str).replace(/<[^>]*>/g, '').trim();
  }

  // ---- Copy to Clipboard ----
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch(e) {
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
    setTimeout(function() {
      const ae = document.activeElement;
      let rec = null;
      if (ae && ae.getAttribute && ae.getAttribute('data-action') && ae !== document.body) {
        rec = {
          action: ae.getAttribute('data-action'),
          id: ae.getAttribute('data-id'),
          field: ae.getAttribute('data-field'),
          idx: ae.getAttribute('data-idx'),
          selStart: (typeof ae.selectionStart === 'number') ? ae.selectionStart : null,
          selEnd: (typeof ae.selectionEnd === 'number') ? ae.selectionEnd : null
        };
      }
      renderFn();
      if (rec && rec.action) {
        let sel = '[data-action="' + rec.action + '"]';
        if (rec.id != null) sel += '[data-id="' + rec.id + '"]';
        if (rec.field != null) sel += '[data-field="' + rec.field + '"]';
        if (rec.idx != null) sel += '[data-idx="' + rec.idx + '"]';
        const el = document.querySelector(sel);
        if (el && el !== document.activeElement) {
          // Defensive guard: native picker inputs (date/time/month/week/
          // datetime-local) re-open their popup the moment they gain focus in
          // Chrome. Never force focus back onto a picker-type input , that
          // would pop the picker back open (the "dates are fighting me" bug).
          // Callers already skip rebuilding the WBS row when a date input has
          // focus (see updTaskField), so this is belt-and-suspenders for any
          // future caller that re-renders a table containing date inputs.
          const pickerType = el.type === 'date' || el.type === 'time' ||
            el.type === 'month' || el.type === 'week' || el.type === 'datetime-local';
          if (!pickerType) {
            try { el.focus(); } catch (e) {}
          }
          if (el.setSelectionRange && rec.selStart != null && el.type === 'text') {
            try { el.setSelectionRange(rec.selStart, rec.selEnd); } catch (e2) {}
          }
        }
      }
    }, 0);
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
    safeParse: function(raw, fallback) {
      if (fallback === undefined) fallback = null;
      try { return JSON.parse(raw); } catch (e) { return fallback; }
    },

    /* BUG #3: truncate list with overflow indicator */
    truncateList: function(arr, limit, fmt) {
      if (!arr || !arr.length) return '';
      var shown = arr.slice(0, limit).map(fmt || function(x) { return String(x); });
      var hidden = Math.max(0, arr.length - limit);
      var result = shown.join('; ');
      return hidden > 0 ? result + ' (and ' + hidden + ' more)' : result;
    },

    /* BUG #7: time constants - single source of truth for ms/day */
    MS_PER_DAY: 86400000,

    /* BUG #4: consistent date formatting */
    fmtDate: function(d) {
      d = d instanceof Date ? d : new Date(d);
      return isNaN(d) ? '' : d.toISOString().slice(0, 10);
    },
    fmtDateLocal: function(d) {
      d = d instanceof Date ? d : new Date(d);
      return isNaN(d) ? '' : d.toLocaleDateString('en-US', {year:'numeric',month:'short',day:'numeric'});
    },
    fmtMoney: function(n) {
      return n != null ? '$' + Number(n).toLocaleString() : '$0';
    }
  };
})(MMGR);
window.MMGR = MMGR;