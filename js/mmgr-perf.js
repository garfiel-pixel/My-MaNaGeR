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

  /* OWNER 2026-09-17 (wave 3 W11): pretty by default, honest about lag.
     A quiet frame-time probe samples the first seconds of interaction; if
     the page keeps missing comfortable frames it nudges ONCE toward the
     Performance Mode toggle. Never auto-flips the setting - the user
     decides. Silences itself permanently for the device after the first
     nudge or dismiss (mmgr_perf_nudge). */
  function startLagProbe() {
    var nudged = false;
    try { nudged = localStorage.getItem('mmgr_perf_nudge') === '1'; } catch (e) {}
    if (nudged || !window.requestAnimationFrame) return;
    // Only surfaces matter: run while a page is visible, skip if the user
    // already trimmed effects (perf off = heavy layers already stood down).
    if (!isOn()) return;
    var frames = 0, slow = 0, tPrev = null, started = 0, done = false;
    function tick(t) {
      if (done) return;
      if (document.hidden) { tPrev = null; requestAnimationFrame(tick); return; }
      if (tPrev !== null) {
        var dt = t - tPrev;
        frames += 1;
        if (dt > 34) slow += 1;   // under ~30fps
        if (!started && frames > 10) started = 1;  // warm-up done
      }
      tPrev = t;
      if (started && frames >= 240) { finish(); return; }   // ~4s sample
      if (t > 60000) { done = true; return; }               // hard stop 60s
      requestAnimationFrame(tick);
    }
    function finish() {
      done = true;
      if (frames < 200) return;                              // too little data
      if (slow / frames < 0.4) return;                       // smooth enough
      try { localStorage.setItem('mmgr_perf_nudge', '1'); } catch (e) {}
      if (ns.App && ns.App.showToast) {
        ns.App.showToast('This device seems to be lagging. Turning on Performance Mode trims the heavy visual effects - find it in the menu under Customize.', 'warn');
      }
    }
    requestAnimationFrame(tick);
  }

  apply();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncInputs);
  } else {
    syncInputs();
  }

  ns.Perf = { isOn: isOn, set: set, apply: apply, syncInputs: syncInputs, blocksHeavyLayers: blocksHeavyLayers, startLagProbe: startLagProbe };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(startLagProbe, 2500); });
  } else {
    setTimeout(startLagProbe, 2500);
  }
})(window.MMGR = window.MMGR || {});
