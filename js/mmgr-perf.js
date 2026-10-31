/* My MaNaGeR - Performance Mode (owner 2026-09-06, REVISED owner 2026-09-15,
   DEFAULT REVERSED owner 2026-09-29: "I want the app page to look good")
   One device-level preference for weak hardware. OFF (default) = the full
   pretty experience - the premium starry glass, 3D deck tilt and the heavy
   blur/shadow layers the owner put the artwork into; ON = everything
   expensive stands down, so a peanut computer never lags:
     - the starry WebGL background does not boot (and tears down if running)
     - 3D deck tilt is off
     - the heaviest CSS blur/shadow layers are lightened via [data-perf=on]
   The 2026-09-15 revision made ON the fresh-device default, which shipped
   the app PLAIN out of the box - the owner reversed it: pretty first, and
   the lag probe (below) nudges toward Performance Mode only when the
   device actually misses frames. */
(function (ns) {
  'use strict';

  var KEY = 'mmgr_perf_mode'; // 'on' = heavy layers stand down, else pretty

  function read() {
    try {
      return localStorage.getItem(KEY);
    } catch (e) {
      return null;
    }
  }

  /** Performance Mode is OFF (pretty) unless the user explicitly turned it on. */
  function isOn() {
    return read() === 'on';
  }

  function set(on) {
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch (e) {
      /* ignore */
    }
    apply();
    /* PERF-1 (REFINEMENT-DIRECTIVE-2026-10-24): tell the decorations, not just
       the CSS. A WebGL scene, a tilt or an rAF loop that is already running
       cannot be stopped by an attribute, so every decoration subscribes to
       this one event and stands down (or restarts) at once. The attribute is
       set first, so a listener that re-reads isOn() always sees the new value. */
    try {
      document.dispatchEvent(new CustomEvent('mmgr:perf', { detail: { on: isOn() } }));
    } catch (e) {
      /* an old browser without CustomEvent: the attribute still did its job */
    }
  }

  /** Mirror the state onto <html> so CSS can react without JS. */
  function apply() {
    var de = document.documentElement;
    if (de) {
      de.setAttribute('data-perf', isOn() ? 'on' : 'off');
    }
  }

  /**
   * Mirror the stored preference onto every Performance Mode checkbox on the
   * page. The static markup ships `checked` as its (pretty-era) default;
   * without this a device whose stored preference differs re-renders the
   * toggle misreporting the real state until it is clicked. Runs at boot
   * (all bundles include this module) and callable after the page renders
   * late-mounted controls.
   */
  function syncInputs() {
    var inputs = document.querySelectorAll('input[type="checkbox"][data-action="tglPerfMode"]');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].checked = isOn();
    }
  }

  /**
   * True while Performance Mode is on: 3D tilt, the starry WebGL background
   * and the heaviest CSS blur/shadow layers ALL stand down (owner 2026-09-15:
   * perf mode must guarantee a lag-free page on weak hardware).
   */
  function blocksHeavyLayers() {
    return isOn();
  }
  /* OWNER 2026-09-17 (wave 3 W11): pretty by default, honest about lag.
     A quiet frame-time probe samples the first seconds of interaction; if
     the page keeps missing comfortable frames it nudges ONCE toward the
     Performance Mode toggle. Never auto-flips the setting - the user
     decides. Silences itself permanently for the device after the first
     nudge or dismiss (mmgr_perf_nudge). With the 2026-09-29 default flip
     the probe finally runs its designed path: it samples while the full
     artwork is active (perf off = pretty default) and only speaks up on a
     device that actually lags. */
  function startLagProbe() {
    // PERF-1: the probe exists to offer the switch. On a page with no app shell
    // (marketing, sign-in) there is no toast to offer it with, so it stays quiet
    // rather than burning the device's one nudge.
    if (!ns.App || !ns.App.showToast) {
      return;
    }
    var nudged = false;
    try {
      nudged = localStorage.getItem('mmgr_perf_nudge') === '1';
    } catch (e) {}
    if (nudged || !window.requestAnimationFrame) {
      return;
    }
    // OWNER 2026-10-09: sample while the HEAVY layers are actually running,
    // which is Performance Mode OFF (pretty is the default). The old guard was
    // `if (!isOn()) return;` - it returned unless perf was ALREADY on, so a
    // laggy device sitting on the default never got the nudge at all, which is
    // the one case the probe exists for. When the user has already turned
    // Performance Mode on, the heavy layers are down and there is nothing to
    // probe.
    if (isOn()) {
      return;
    }
    var frames = 0,
      slow = 0,
      tPrev = null,
      started = 0,
      done = false;
    function tick(t) {
      if (done) {
        return;
      }
      if (document.hidden) {
        tPrev = null;
        requestAnimationFrame(tick);
        return;
      }
      if (tPrev !== null) {
        var dt = t - tPrev;
        frames += 1;
        if (dt > 34) {
          slow += 1;
        } // under ~30fps
        if (!started && frames > 10) {
          started = 1;
        } // warm-up done
      }
      tPrev = t;
      if (started && frames >= 240) {
        finish();
        return;
      } // ~4s sample
      if (t > 60000) {
        done = true;
        return;
      } // hard stop 60s
      requestAnimationFrame(tick);
    }
    function finish() {
      done = true;
      if (frames < 200) {
        return;
      } // too little data
      if (slow / frames < 0.4) {
        return;
      } // smooth enough
      try {
        localStorage.setItem('mmgr_perf_nudge', '1');
      } catch (e) {}
      if (ns.App && ns.App.showToast) {
        ns.App.showToast(
          'This device seems to be lagging. Turning on Performance Mode trims the heavy visual effects - find it in the menu under Customize.',
          'warn'
        );
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

  /* PERF-1 (REFINEMENT-DIRECTIVE-2026-10-24): the switch works on EVERY page
     that loads this module, including the calculator's top bar and the marketing
     footer - those pages have no action dispatcher, so the control is wired
     here, once, by delegation. A page that does have a dispatcher (app.html,
     project.html) calls set() from its own handler; set() is idempotent, so the
     double call is harmless. */
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!el || el.type !== 'checkbox' || el.getAttribute('data-action') !== 'tglPerfMode') {
      return;
    }
    set(!!el.checked);
  });
  document.addEventListener('mmgr:perf', syncInputs);

  /* OWNER 2026-10-31 (audit finding 11): Performance Mode changed in another
     tab must reach this one - theme and perf are two independent device
     preferences, and neither may sit stale while the other tab is open. The
     `storage` event only fires for a real change in another tab, so this can
     never echo the write made here. It re-applies the attribute, mirrors the
     switches and tells the decorations (the same event set() fires). */
  window.addEventListener('storage', function (e) {
    if (!e || e.key !== KEY) {
      return;
    }
    apply();
    syncInputs();
    try {
      document.dispatchEvent(new CustomEvent('mmgr:perf', { detail: { on: isOn() } }));
    } catch (err) {
      /* old browser: the attribute still did its job */
    }
  });

  ns.Perf = {
    isOn: isOn,
    set: set,
    apply: apply,
    syncInputs: syncInputs,
    blocksHeavyLayers: blocksHeavyLayers,
    startLagProbe: startLagProbe
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(startLagProbe, 2500);
    });
  } else {
    setTimeout(startLagProbe, 2500);
  }
})((window.MMGR = window.MMGR || {}));
