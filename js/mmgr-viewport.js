/* ============================================================
   My MaNaGeR — Viewport-Aware Layout Detection (Rank 3.4)
   ------------------------------------------------------------
   Detection, not assumption: a narrow/portrait viewport is judged
   from the actual viewport (width/height ratio + orientation
   media query), never from user-agent sniffing.

   For views built for wide layouts (Gantt, RACI matrix, EVM /
   budget tables, WBS) on a narrow viewport, the user is offered a
   SINGLE, dismissible prompt per device (stored in localStorage —
   the same device-level preference slot Rank 4's PWA layer uses;
   this is intentionally NOT project state, it is a screen
   preference). Never auto-switch silently, never re-prompt after
   a choice. The simplified view is presentation-only: dense
   tables become stacked cards via the .vp-simple class, and a
   "view full table" escape hatch restores the wide layout for
   that panel.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;

  // Sections whose natural layout is wide/dense and therefore benefit from
  // a simplified stacked presentation on a narrow screen.
  const DENSE_SECTIONS = ['gantt', 'raci', 'bud', 'wbs', 'res'];

  // Preference storage: device-level, one slot per section. Values:
  //   undefined -> never asked
  //   'simple'  -> user accepted the simplified view for this section
  //   'dismiss' -> user dismissed the prompt; don't ask again on this device
  const PREF_PREFIX = 'mmgr_vp_';

  // ---- PLAN-OF-ACTION-LIQUID-GLASS-UI Rank 3.5: shared capability signal ---
  // ONE detection path, TWO consumers. The same isHighEnd() verdict that
  // decides simplified-vs-full layout on narrow screens also decides
  // Premium-glass-vs-CSS-glass, so a low-end device never pays for a heavy
  // WebGL layer it was already spared by the layout logic. The glass mode
  // preference lives in the same device-level slot family as the viewport
  // prefs (localStorage, never project state).
  //   'css'     -> CSS backdrop-filter glass (the universal default)
  //   'premium' -> opt-in Three.js liquid-glass engine (capable devices only)
  const GLASS_KEY = 'mmgr_glass_mode';

  // Hardware-capability floor (3.5.2): enough parallel cores AND a sane
  // devicePixelRatio. A genuine low-end profile reports premium as
  // unavailable REGARDLESS of any stored preference — capability floor
  // overrides preference, preference never overrides incapability.
  function hasWebGL() {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) { return false; }
  }
  function isHighEnd() {
    // Test hook (same convention as qa-voice's forcedModelUrl): a QA gate
    // can force the verdict deterministically. Production never sets it.
    if (typeof window.__mmgrForceHighEnd === 'boolean') return window.__mmgrForceHighEnd;
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    return cores >= 6 && dpr <= 2.5 && hasWebGL();
  }

  function getGlassMode() {
    try { return localStorage.getItem(GLASS_KEY) === 'premium' ? 'premium' : 'css'; }
    catch (e) { return 'css'; }
  }
  function setGlassMode(mode) {
    try { localStorage.setItem(GLASS_KEY, mode === 'premium' ? 'premium' : 'css'); } catch (e) { /* ignore */ }
  }
  // The single decision both consumers read. Premium requires: stored
  // preference 'premium' AND capability floor AND a wide viewport (a narrow
  // screen gets CSS glass + the simplified layout, never a heavy engine).
  function effectiveGlassMode() {
    if (getGlassMode() !== 'premium') return 'css';
    if (!isHighEnd()) return 'css'; // capability floor overrides preference
    if (isNarrow()) return 'css';   // shared detection: narrow => CSS only
    return 'premium';
  }

  function prefKey(section) { return PREF_PREFIX + section; }

  function getPref(section) {
    try { return localStorage.getItem(prefKey(section)); } catch (e) { return null; }
  }

  function setPref(section, val) {
    try { localStorage.setItem(prefKey(section), val); } catch (e) { /* ignore */ }
  }

  // ---- Detection (viewport facts only, no UA sniffing) ----
  function isNarrow() {
    const w = window.innerWidth || document.documentElement.clientWidth || 0;
    const h = window.innerHeight || document.documentElement.clientHeight || 0;
    const portrait = (typeof window.matchMedia === 'function') && window.matchMedia('(orientation: portrait)').matches;
    // Portrait ratio (w < h) OR a hard small-width cutoff — a phone held in
    // landscape still has a small width and gets the prompt.
    return portrait || w <= 640;
  }

  function isDense(section) {
    return DENSE_SECTIONS.indexOf(section) > -1;
  }

  function isSimplified(section) {
    const panel = U.$('panel-' + section);
    return !!(panel && panel.classList.contains('vp-simple'));
  }

  // ---- Apply / clear the simplified presentation for a panel ----
  function applySimple(section, on) {
    const panel = U.$('panel-' + section);
    if (!panel) return;
    panel.classList.toggle('vp-simple', !!on);
    panel.classList.toggle('vp-full', false); // leaving simplified clears the escape hatch
    const btn = panel.querySelector('.vp-full-btn');
    if (on && !btn) {
      const b = document.createElement('button');
      b.className = 'btn btn-n btn-s vp-full-btn';
      b.setAttribute('data-action', 'vpFull');
      b.setAttribute('data-section', section);
      b.title = 'Temporarily show the full wide layout for this panel';
      b.innerHTML = '<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-bar-chart"></use></svg> View full table';
      panel.insertBefore(b, panel.firstChild);
    } else if (!on && btn) {
      btn.remove();
    }
  }

  // Toggle the "view full table" escape hatch for a panel (temporary, until
  // the user leaves the section — the preference itself stays).
  function toggleFull(section) {
    const panel = U.$('panel-' + section);
    if (!panel) return;
    panel.classList.toggle('vp-full', !panel.classList.contains('vp-full'));
  }

  // ---- The one-time dismissible prompt ----
  // Renders a small bar at the top of the panel body. Exactly one prompt per
  // device per section; answering stores the preference so it never fires
  // again on this device. Never auto-switches.
  function maybePrompt(section) {
    const panel = U.$('panel-' + section);
    if (!panel || !isDense(section)) return;
    const pref = getPref(section);
    if (pref === 'simple') { applySimple(section, true); return; }
    if (pref === 'dismiss') { applySimple(section, false); return; }
    if (!isNarrow()) return; // wide viewport: nothing to offer
    // First time on this device for a dense section on a narrow screen.
    let bar = panel.querySelector('.vp-prompt');
    if (bar) return; // already offered
    bar = document.createElement('div');
    bar.className = 'vp-prompt';
    bar.innerHTML =
      '<span class="vp-prompt-txt">This view is built for a wide screen. Switch to a simplified stacked view for this screen?</span>' +
      '<span class="vp-prompt-actions">' +
      '<button class="btn btn-g btn-s" data-action="vpAccept" data-section="' + U.escapeHtml(section) + '"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-check"></use></svg> Switch</button>' +
      '<button class="btn btn-n btn-s" data-action="vpDismiss" data-section="' + U.escapeHtml(section) + '">Not now</button>' +
      '</span>';
    panel.insertBefore(bar, panel.firstChild);
  }

  // User accepted: apply simplified + remember on this device.
  function accept(section) {
    setPref(section, 'simple');
    applySimple(section, true);
    removePrompt(section);
    if (ns.App && ns.App.showToast) ns.App.showToast('Simplified view on for this screen — toggle full table anytime from the panel.', 'ok');
  }

  // User dismissed: remember so it is never re-prompted on this device.
  function dismiss(section) {
    setPref(section, 'dismiss');
    applySimple(section, false);
    removePrompt(section);
  }

  function removePrompt(section) {
    const panel = U.$('panel-' + section);
    if (!panel) return;
    const bar = panel.querySelector('.vp-prompt');
    if (bar) bar.remove();
  }

  // Clear a stored preference (used by tests / reset).
  function clearPref(section) {
    try { localStorage.removeItem(prefKey(section)); } catch (e) { /* ignore */ }
    removePrompt(section);
  }

  // ---- API ----
  ns.Viewport = {
    DENSE_SECTIONS: DENSE_SECTIONS.slice(),
    isNarrow: isNarrow,
    isDense: isDense,
    isSimplified: isSimplified,
    applySimple: applySimple,
    toggleFull: toggleFull,
    maybePrompt: maybePrompt,
    accept: accept,
    dismiss: dismiss,
    clearPref: clearPref,
    getPref: getPref,
    // Rank 3.5 (PLAN-OF-ACTION-LIQUID-GLASS-UI): shared capability signal
    // + glass mode preference. One detection path, two consumers.
    hasWebGL: hasWebGL,
    isHighEnd: isHighEnd,
    getGlassMode: getGlassMode,
    setGlassMode: setGlassMode,
    effectiveGlassMode: effectiveGlassMode
  };
})(MMGR);
window.MMGR = MMGR;
