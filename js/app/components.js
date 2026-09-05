/* ============================================================
   My MaNaGeR - Shared UI Component Templates
   ============================================================
   Centralized template helpers for repeated UI patterns:
   badges, status pills, and AI badges. Ensures visual
   consistency across all render modules.

   Usage: MMGR.Components.badge(text, variant, opts)
          MMGR.Components.reviewBadge(status)
          MMGR.Components.aiBadge(label, title)
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  /**
   * @typedef {Object} BadgeOpts
   * @property {string} [className]  - extra CSS classes to append
   * @property {string} [style]      - inline style string
   * @property {string} [title]      - tooltip title attribute
   * @property {string} [fontSize]   - shorthand for font-size override
   * @property {string} [padding]    - shorthand for padding override
   * @property {boolean} [nowrap]    - add white-space:nowrap
   */

  // Badge variant → CSS class mapping.
  // bg = green/done, ba = amber/open, br = red/overdue/risk,
  // bo = orange/caution, bs = blue/in-progress, bp = purple/AI
  var VARIANTS = {
    done:      'bg',  completed: 'bg',  awarded:  'bg',  ok:    'bg',
    active:    'ba',  open:      'ba',  live:     'ba',
    overdue:   'br',  risk:      'br',  danger:   'br',  err:   'br',
    caution:   'bo',  critical:  'bo',
    progress:  'bs',  planning:  'bs',  review:   'bs',
    hold:      'on-hold',
    ai:        'badge-ai'
  };

  /**
   * Render a status badge <span>.
   *
   * @param {string} text      - label inside the badge (e.g. "done", "RISK")
   * @param {string} [variant] - semantic key (done/active/overdue/etc.) OR raw CSS class (bg/ba/br)
   * @param {BadgeOpts} [opts]
   * @returns {string} HTML string
   */
  function badge(text, variant, opts) {
    opts = opts || {};
    var cls = VARIANTS[variant] || variant || 'bg';
    var style = '';
    if (opts.fontSize)  style += 'font-size:' + opts.fontSize + ';';
    if (opts.padding)   style += 'padding:' + opts.padding + ';';
    if (opts.nowrap)    style += 'white-space:nowrap;';
    if (opts.style)     style += opts.style;
    var titleAttr = opts.title ? ' title="' + opts.title.replace(/"/g, '&quot;') + '"' : '';
    var classAttr = 'badge ' + cls + (opts.className ? ' ' + opts.className : '');
    return '<span class="' + classAttr + '"' +
           (style ? ' style="' + style + '"' : '') +
           titleAttr + '>' + text + '</span>';
  }

  /**
   * Render the MCP AI badge (sparkle icon + label).
   *
   * @param {string} [label] - default "MCP AI"
   * @param {string} [title] - tooltip
   * @returns {string} HTML string
   */
  function aiBadge(label, title) {
    var t = title ? ' title="' + title.replace(/"/g, '&quot;') + '"' : '';
    return '<span class="badge-ai"' + t + '>' +
           '<svg class="ico" aria-hidden="true">' +
           '<use href="css/mmgr-icons.svg#i-sparkle"></use></svg> ' +
           (label || 'MCP AI') + '</span>';
  }

  /**
   * Render a review proposal status badge.
   *
   * @param {"pending"|"accepted"|"rejected"} status
   * @returns {string} HTML string
   */
  function reviewBadge(status) {
    var map = {
      pending:  { color: 'var(--gold)',   bg: 'rgba(245,158,11,.12)', border: 'rgba(245,158,11,.35)' },
      accepted: { color: 'var(--green)',  bg: 'rgba(16,185,129,.12)', border: 'var(--green)' },
      rejected: { color: '#ef4444',       bg: 'rgba(239,68,68,.12)',  border: 'rgba(239,68,68,.5)' }
    };
    var s = map[status] || map.pending;
    return '<span class="badge" style="color:' + s.color +
           ';border:1px solid ' + s.border +
           ';background:' + s.bg + '">' + status + '</span>';
  }

  // ---- Shared toast (loads before mmgr-app.js, eliminates duplicate in mmgr-cloud-dash.js) ----
  var TOAST_ICONS = { err: 'i-x', error: 'i-x', warn: 'i-alert-triangle', ok: 'i-check-circle' };
  var TOAST_LABELS = { err: 'Error', error: 'Error', warn: 'Note' };

  /**
   * Show a pill-shaped glass toast notification.
   * @param {string} msg
   * @param {string} [type] - 'ok'|'err'|'error'|'warn' (default 'ok')
   * @param {Object} [action] - { label: string, fn: function } optional action button
   */
  function showToast(msg, type, action) {
    var existing = document.querySelector('.toast');
    if (existing) existing.remove();
    var isErr = type === 'err' || type === 'error';
    var isWarn = type === 'warn';
    var t = document.createElement('div');
    t.className = 'toast ' + (isErr ? 'err' : (isWarn ? 'warn' : 'ok'));
    t.setAttribute('role', isErr ? 'alert' : 'status');
    t.setAttribute('aria-live', isErr ? 'assertive' : 'polite');
    var icon = TOAST_ICONS[type] || 'i-check-circle';
    var label = TOAST_LABELS[type] || 'Done';
    t.innerHTML = '<span class="toast-ico"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#' + icon + '"></use></svg></span>' +
                  '<span class="toast-body"><b></b><span></span></span>' +
                  (action && action.label ? '<button type="button" class="toast-act" role="button"></button>' : '');
    t.querySelector('b').textContent = label;
    t.querySelector('.toast-body > span').textContent = msg;
    var actBtn = t.querySelector('.toast-act');
    if (actBtn && action && action.label) {
      actBtn.textContent = action.label;
      actBtn.addEventListener('click', function() {
        clearTimeout(t._hideT); clearTimeout(t._killT);
        t.classList.remove('is-out');
        t.remove();
        try { (action.fn || action.onClick)(); } catch (e) { /* caller guards */ }
      });
    }
    document.body.appendChild(t);
    var hold = (action && action.label) ? 6000 : 2600;
    t._hideT = setTimeout(function() { t.classList.add('is-out'); }, hold);
    t._killT = setTimeout(function() { t.remove(); }, hold + 500);
  }

  // ---- Public API ----
  ns.Components = {
    badge: badge,
    aiBadge: aiBadge,
    reviewBadge: reviewBadge,
    showToast: showToast,
    VARIANTS: VARIANTS
  };

})(MMGR);
