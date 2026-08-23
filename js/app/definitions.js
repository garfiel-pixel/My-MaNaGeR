/* ============================================================
   My MaNaGeR , Definitions Tooltips
   Floating tooltip for data-def elements.
   Extracted from mmgr-app.js.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;

  let _defTipEl = null;
  let _defTipTimer = null;

  function defTipFor(term) {
    if (!ns.Defs || !ns.Defs.DATA) return null;
    const entry = ns.Defs.DATA.find(d => d.term.toLowerCase() === String(term || '').toLowerCase());
    return entry || null;
  }

  function showDefTip(el, term) {
    const entry = defTipFor(term);
    if (!entry) return;
    if (_defTipTimer) { clearTimeout(_defTipTimer); _defTipTimer = null; }
    if (!_defTipEl) {
      _defTipEl = document.createElement('div');
      _defTipEl.id = 'def-tooltip';
      _defTipEl.className = 'def-tooltip';
      document.body.appendChild(_defTipEl);
    }
    _defTipEl.innerHTML = '<div class="dt-term">' + U.escapeHtml(entry.term) + (entry.group ? '<span class="def-badge">' + U.escapeHtml(entry.group) + '</span>' : '') + '</div>' +
      '<div class="dt-body">' + U.escapeHtml(entry.meaning) + '</div>';
    _defTipEl.classList.add('vis');
    const r = el.getBoundingClientRect();
    _defTipEl.style.left = Math.min(r.left, window.innerWidth - 280) + 'px';
    _defTipEl.style.top = (r.bottom + 8) + 'px';
  }

  function hideDefTip() {
    if (_defTipTimer) { clearTimeout(_defTipTimer); _defTipTimer = null; }
    if (_defTipEl) _defTipEl.classList.remove('vis');
  }

  ns.AppDefs = {
    defTipFor: defTipFor,
    showDefTip: showDefTip,
    hideDefTip: hideDefTip
  };
})(MMGR);
window.MMGR = MMGR;
