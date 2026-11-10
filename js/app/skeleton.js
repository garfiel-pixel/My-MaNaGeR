/*
 * Wave 5 (owner 2026-11-10): skeletons that mirror the real page.
 *
 * Every section gets a template whose SHAPE matches what is about to render:
 * the dashboard metric cards, the WBS table rows, the Kanban columns, the
 * budget summary + rows, the risk cards, the photo grid, the meeting list, the
 * team list and the calculator bill. The boot splash and the launcher/cloud
 * lists already paint their own shapes; this module is the one seam the rest of
 * the app can call when a render is genuinely deferred.
 *
 * Honesty rule: a skeleton is only painted where a real wait exists (project
 * boot, launcher registry/cloud list, a hydrated bill). `paint()` does NOT
 * pretend a synchronous render is loading - it is a tool for the call sites
 * that actually await something.
 *
 * The markup uses the existing .skel-box token-driven sheen, so reduced motion
 * renders static boxes with no new animation code.
 */
(function (MMGR) {
  'use strict';
  var ns = MMGR || (window.MMGR = {});

  function box(cls, extra) {
    return '<span class="skel-box ' + cls + '"' + (extra ? ' ' + extra : '') + '></span>';
  }
  function rows(n, cls) {
    var out = '';
    for (var i = 0; i < n; i++) {
      out += '<div class="' + cls + '">' + box('skel-line') + box('skel-line skel-w-20') + '</div>';
    }
    return out;
  }

  var T = {
    dash:
      '<div class="skel-metrics">' +
      '<div class="skel-metric">' +
      box('skel-line skel-w-40') +
      box('skel-line t-lg skel-w-60') +
      '</div>' +
      '<div class="skel-metric">' +
      box('skel-line skel-w-40') +
      box('skel-line t-lg skel-w-60') +
      '</div>' +
      '<div class="skel-metric">' +
      box('skel-line skel-w-40') +
      box('skel-line t-lg skel-w-60') +
      '</div>' +
      '</div>' +
      '<div class="skel-panel">' +
      box('skel-card skel-tall') +
      '</div>',
    wbs:
      '<div class="skel-table">' +
      '<div class="skel-tr skel-tr-head">' +
      box('skel-line skel-w-40') +
      box('skel-line skel-w-20') +
      '</div>' +
      rows(6, 'skel-tr') +
      '</div>',
    kanban:
      '<div class="skel-board">' +
      '<div class="skel-col">' +
      box('skel-line skel-w-40') +
      box('skel-card') +
      box('skel-card') +
      '</div>' +
      '<div class="skel-col">' +
      box('skel-line skel-w-40') +
      box('skel-card') +
      '</div>' +
      '<div class="skel-col">' +
      box('skel-line skel-w-40') +
      box('skel-card') +
      box('skel-card') +
      '</div>' +
      '</div>',
    budget:
      '<div class="skel-metrics">' +
      '<div class="skel-metric">' +
      box('skel-line skel-w-40') +
      box('skel-line t-lg skel-w-60') +
      '</div>' +
      '<div class="skel-metric">' +
      box('skel-line skel-w-40') +
      box('skel-line t-lg skel-w-60') +
      '</div>' +
      '</div>' +
      '<div class="skel-table">' +
      rows(5, 'skel-tr') +
      '</div>',
    risks:
      '<div class="skel-cards">' +
      box('skel-card') +
      box('skel-card') +
      box('skel-card') +
      box('skel-card') +
      '</div>',
    photos:
      '<div class="skel-grid">' +
      box('skel-card') +
      box('skel-card') +
      box('skel-card') +
      box('skel-card') +
      box('skel-card') +
      box('skel-card') +
      '</div>',
    meetings: '<div class="skel-list">' + rows(4, 'skel-li') + '</div>',
    team: '<div class="skel-list">' + rows(4, 'skel-li') + '</div>',
    bill: '<div class="skel-table">' + rows(4, 'skel-tr') + '</div>',
    launcher:
      '<div class="skel-cards">' +
      box('skel-card skel-tall') +
      box('skel-card skel-tall') +
      box('skel-card skel-tall') +
      '</div>',
    cloud:
      '<div class="skel-cards">' +
      box('skel-card skel-tall') +
      box('skel-card skel-tall') +
      box('skel-card skel-tall') +
      '</div>'
  };

  function html(section) {
    // ok: static skeleton template strings only - no user or model data
    return T[section] || T.dash;
  }

  // Fill `target` with the section shape and mark it busy. Returns a clear()
  // function that removes the skeleton and the busy flag.
  function paint(section, target) {
    if (!target) {
      return function () {};
    }
    // ok: captured from the same node and restored verbatim
    var prev = target.innerHTML;
    target.setAttribute('aria-busy', 'true');
    // ok: static skeleton template strings only
    target.innerHTML = html(section);
    return function clear() {
      target.removeAttribute('aria-busy');
      // ok: restored verbatim from the same node
      target.innerHTML = prev;
    };
  }

  ns.Skeleton = {
    skeletonHtml: html,
    skeletonPaint: paint,
    skeletonSections: Object.keys(T)
  };
})(window.MMGR);
