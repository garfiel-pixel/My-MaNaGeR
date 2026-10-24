// My MaNaGeR - Performance Mode boot script
// Loads early (data-sync="1") after mmgr-theme.js so ns.Perf is available
// on every page calculator/html/marketing. Gates RAF loops and subscribes
// to the mmgr:perf event so modules can react to the user's perf choice.

/* eslint-disable */
// Suppress any early-noise lint on this tiny boot file

(function () {
  // Minimal perf detection + boot logic
  'use strict';

  // If ns.Perf doesn't exist yet (mmgr-perf.js not loaded), create a safe no-op
  window.ns = window.ns || {};
  window.ns.Perf = window.ns.Perf || {};

  // Read stored preference; default to 'off' (pretty) so artwork is visible out-of-box
  var stored = localStorage.getItem('mmgr_perf_mode');
  if (stored === 'on') {
    window.ns.Perf.isOn = true;
    document.documentElement.setAttribute('data-perf', 'on');
  } else {
    window.ns.Perf.isOn = false;
    document.documentElement.removeAttribute('data-perf');
  }

  // Subscribe to the mmgr:perf event so later-loaded modules can react
  // This is a simple pub-sub; mmgr-perf.js will also publish on this event
  window.ns.Perf.subscribe = function (fn) {
    var fns = this._subs || (this._subs = []);
    fns.push(fn);
    return function () {
      if (fns.splice(fns.indexOf(fn), 1) < 0) {
      }
    };
  };

  // Notify any subscribed modules of the current state
  if (this._subs && this._subs.length) {
    this._subs.forEach(function (fn) {
      fn(window.ns.Perf.isOn);
    });
  }
})();
