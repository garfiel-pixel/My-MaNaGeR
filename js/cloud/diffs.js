/* ============================================================
   My MaNaGeR , Cloud Diff Panel
   Click-to-expand before/after diff rendering.
   Extracted from mmgr-cloud.js.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const C = ns.Cloud;
  const $ = function(id) { return document.getElementById(id); };
  function esc(v) { return C._esc(v); }

  function clVal(v, absent, cls) {
    if (absent) return '<em class="cl-absent">absent</em>';
    let s;
    if (v === undefined) v = null;
    if (v === null) s = 'null';
    else if (typeof v === 'object') {
      try { s = JSON.stringify(v); } catch (e) { s = String(v); }
    } else s = String(v);
    const title = s.length > 140 ? ' title="' + esc(s) + '"' : '';
    const shown = s.length > 140 ? s.slice(0, 137) + '\u2026' : s;
    return '<code class="cl-val ' + cls + '"' + title + '>' + esc(shown) + '</code>';
  }

  function renderDiffPanel(en) {
    const diffs = (Array.isArray(en.diffs) ? en.diffs : []).slice(0, 60);
    const n = Array.isArray(en.diffs) ? en.diffs.length : 0;
    if (!diffs.length) return '';
    let rows = '';
    for (let i = 0; i < diffs.length; i++) {
      const d = diffs[i] || {};
      rows += '<div class="cl-diff">' +
        '<code class="cl-diff-path" title="' + esc(String(d.path || '')) + '">' + esc(String(d.path || '?')) + '</code>' +
        clVal(d.before, d.beforeAbsent === true, 'cl-old') +
        '<span class="cl-arr">\u2192</span>' +
        clVal(d.after, d.afterAbsent === true, 'cl-new') +
        '</div>';
    }
    if (n > diffs.length) rows += '<div class="cl-more">\u2026 and ' + (n - diffs.length) + ' more field(s)</div>';
    return '<div class="cl-diffs-head"><span>Field</span><span>Before</span><span></span><span>After</span></div>' + rows;
  }

  function toggleDiffs(id) {
    const panel = $('cl-diffs-' + id);
    if (!panel) return;
    const show = panel.classList.contains('is-hide');
    panel.classList.toggle('is-hide');
    const btn = document.querySelector('#cloud-log-list [data-action="cloudLogToggleDiffs"][data-id="' + String(id).replace(/"/g, '&quot;') + '"]');
    if (btn) {
      btn.classList.toggle('open', show);
      btn.setAttribute('aria-expanded', show ? 'true' : 'false');
    }
  }

  ns.CloudDiffs = {
    clVal: clVal,
    renderDiffPanel: renderDiffPanel,
    toggleDiffs: toggleDiffs
  };
})(MMGR);
window.MMGR = MMGR;
