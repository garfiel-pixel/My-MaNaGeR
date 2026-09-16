/* My MaNaGeR - Performance Mode (owner 2026-09-06, REVISED owner 2026-09-15)
   One device-level preference for weak hardware. ON (default) = the full
   pretty experience the machine can handle; OFF = everything expensive
   stands down, so a peanut computer never lags:
     - the starry WebGL background does not boot (and tears down if running)
     - 3D deck tilt is off
     - the heaviest CSS blur/shadow layers are lightened via [data-perf=on]
   The revision reverses the earlier "shader is mandatory identity" rule:
   the owner now explicitly wants perf mode to kill the star background too. */
(function (ns) {
  'use strict';

  var KEY = 'mmgr_perf_mode'; // 'off' = heavy layers allowed, else ON

  function read() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  /** Performance Mode is ON unless the user explicitly turned it off. */
  function isOn() { return read() !== 'off'; }

  function set(on) {
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* ignore */ }
    apply();
  }

  /** Mirror the state onto <html> so CSS can react without JS. */
  function apply() {
    var de = document.documentElement;
    if (de) de.setAttribute('data-perf', isOn() ? 'on' : 'off');
  }

  /**
   * Mirror the stored preference onto every Performance Mode checkbox on the
   * page. The static markup ships `checked` as its default; without this a
   * device whose stored preference is 'off' re-renders the toggle as ON and
   * the control misreports the real state until it is clicked.
   * Runs at boot (all bundles include this module) and callable after the
   * page renders late-mounted controls.
   */
  function syncInputs() {
    var inputs = document.querySelectorAll('input[type="checkbox"][data-action="tglPerfMode"]');
    for (var i = 0; i < inputs.length; i++) inputs[i].checked = isOn();
  }

  /**
   * True while Performance Mode is on: 3D tilt, the starry WebGL background
   * and the heaviest CSS blur/shadow layers ALL stand down (owner 2026-09-15:
   * perf mode must guarantee a lag-free page on weak hardware).
   */
  function blocksHeavyLayers() { return isOn(); }

  apply();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncInputs);
  } else {
    syncInputs();
  }

  ns.Perf = { isOn: isOn, set: set, apply: apply, syncInputs: syncInputs, blocksHeavyLayers: blocksHeavyLayers };
})(window.MMGR = window.MMGR || {});
