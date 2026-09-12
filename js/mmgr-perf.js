/* My MaNaGeR - Performance Mode (owner 2026-09-06)
   One device-level preference that trims the expensive CSS effects (heavy
   backdrop blur, long shadows, large blurs) and the 3D deck tilt. The starry
   liquid-glass shader is NOT gated by this module - it is mandatory app
   identity (owner directive) and already self-gates via the capability floor
   (mmgr-viewport.isHighEnd) and reduced-motion preferences.
     - Performance Mode ON  (default): every animation/transition stays, but
       the heaviest blur/shadow layers are lightened via [data-perf=on] CSS.
     - Performance Mode OFF: full visual weight.
   Nothing announces itself: no toasts, no labels. The theme picker
   (Light/Dark/System) and this toggle are the whole appearance panel. */
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
   * True while Performance Mode is on: 3D tilt and the heaviest CSS blur/
   * shadow layers stand down. The WebGL shader does NOT consult this -
   * it is capability-gated in mmgr-viewport.effectiveGlassMode().
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
