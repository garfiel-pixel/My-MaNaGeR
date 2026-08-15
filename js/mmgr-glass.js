/* ============================================================
   My MaNaGeR — Dual-Engine Glass UI: Premium Liquid-Glass Engine
   (PLAN-OF-ACTION-LIQUID-GLASS-UI Rank 3.5, items 3.5.4 + 3.5.5)
   ------------------------------------------------------------
   The CSS `backdrop-filter` glass treatment is the universal
   default (zero JS, zero opt-in — see css/mmgr.css). This module
   is the OPT-IN "Premium" tier: a Three.js liquid-glass backdrop
   rendered on a full-viewport canvas BEHIND the app.

   Hard gates (per the plan, not just intent):
   - Three.js is NEVER bundled or loaded at boot. It is fetched
     from a version-pinned CDN URL via dynamic import() ONLY when
     BOTH 3.5.2's detection (Viewport.isHighEnd + preference) and
     3.5.3's settings toggle allow it. With the toggle off, zero
     network request is made — verified by qa-glass.cjs.
   - The CDN URL is a real, verified Three.js link (unpkg,
     three@0.160.0), NOT the placeholder cloudflare.com reference
     from the source document.
   - 3.5.5 shared teardown: switching back to CSS (toggle, resize
     into a narrow viewport, capability re-check) disposes the
     renderer AND forces WebGL context loss — no leaked contexts.
   - Circuit-broken like every other optional network path: an
     import failure, a WebGL failure, or a context loss degrades
     to CSS glass with a toast, never a crash.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  // Pinned, verified Three.js CDN (checked live at implementation time:
  // https://unpkg.com/three@0.160.0/build/three.module.js returns 200).
  const THREE_CDN = 'https://unpkg.com/three@0.160.0/build/three.module.js';

  // Fresh engine state — reset by deactivate() so a re-activate never sees
  // stale refs from a previous session.
  function freshState() {
    return {
      active: false,
      renderer: null,
      scene: null,
      camera: null,
      mesh: null,
      uniforms: null,
      clock: null,
      canvas: null,
      rafId: 0,
      ctxLost: false
    };
  }
  let _state = freshState();

  function active() { return _state.active; }

  // Test seam (same convention as qa-voice's forcedModelUrl / the viewport
  // __mmgrForceHighEnd hook): a QA gate injects a fake THREE module here to
  // verify the lifecycle deterministically without the network. Production
  // never sets it — the real dynamic import from the pinned CDN is used.
  function _importThree() {
    if (typeof window.__mmgrThreeImport === 'function') return window.__mmgrThreeImport();
    if (typeof window.__mmgrGlassImportCalls === 'number') window.__mmgrGlassImportCalls++;
    return import(THREE_CDN);
  }

  // ---- Shaders: liquid-glass refraction (FIX-1, Option B) ----
  // The flat blob-glow shader was replaced with a genuine glass-refraction look:
  // a procedural liquid field is sampled at RGB-channel-offset UVs along a
  // slowly drifting distortion vector, so edges of the field bend like light
  // through glass — but the chromatic offset is kept small (0.004) so edges
  // never rainbow. The palette is CONSTRAINED: a cool slate base with only a
  // very-low-weight warm-gold accent (no iridescent multi-hue wash), and the
  // accent is mixed into the theme base at <= 0.15 (dark) / 0.06 (light) so the
  // glass stays dark in dark mode and near off-white in light mode. A faint
  // specular sheen + vignette are kept so the surface still reads as physical
  // glass. The background is procedural (in-shader), so no texture uploads and
  // no new THREE API surface — the qa-glass.cjs fake-THREE mock stays valid and
  // the lifecycle gate is untouched. One full-screen quad, one draw call,
  // theme-aware (uDark switches base + tint strength).
  const VERT = [
    'void main() {',
    '  gl_Position = vec4(position.xy, 0.0, 1.0);',
    '}'
  ].join('\n');

  const FRAG = [
    'precision highp float;',
    'uniform float uTime;',
    'uniform vec2 uRes;',
    'uniform float uDark;',
    'uniform float uCyan;',
    // Cheap high-quality hash (no transcendentals) — the backdrop stays fast even
    // at high pixel ratios.
    'float hash(vec2 p){',
    '  p = fract(p * vec2(123.34, 456.21));',
    '  p += dot(p, p + 45.32);',
    '  return fract(p.x * p.y);',
    '}',
    'float vnoise(vec2 p){',
    '  vec2 i = floor(p);',
    '  vec2 f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(',
    '    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),',
    '    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),',
    '    u.y);',
    '}',
    'float fbm(vec2 p){',
    '  float v = 0.0;',
    '  float amp = 0.5;',
    '  for (int i = 0; i < 4; i++){',
    '    v += amp * vnoise(p);',
    '    p = p * 2.02 + vec2(17.3, 9.1);',
    '    amp *= 0.5;',
    '  }',
    '  return v;',
    '}',
    // The liquid height field — the "background" the glass refracts. Procedural
    // (in-shader), so the engine never uploads a texture and the QA mock surface
    // stays unchanged (FIX-1 Option B design decision).
    'float field(vec2 p){',
    '  return fbm(p);',
    '}',
    // Constrained palette — cool slate is the only hue, with a warm-gold accent
    // at very low weight (0.22 max), so the field never shows the old iridescent
    // purple/green/orange wash. Theme-compatible in both light and dark. The
    // cyan palette swaps the accent to a fluorescent-cyan vector (uCyan uniform,
    // driven by <html data-theme> so premium glass respects the active theme).
    'vec3 palette(float t){',
    '  vec3 slate = vec3(0.32, 0.36, 0.46);',
    '  vec3 gold  = vec3(0.72, 0.56, 0.30);',
    '  vec3 cyan  = vec3(0.30, 0.84, 0.92);',
    '  float w = 0.5 + 0.5 * sin(6.2831 * t * 0.4 + 1.7);',
    '  return mix(slate, mix(gold, cyan, uCyan), 0.22 * w);',
    '}', 
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uRes;',
    '  vec2 p = uv - 0.5;',
    '  p.x *= uRes.x / max(uRes.y, 1.0);',
    '  float t = uTime * 0.22;',
    '  // Domain warp: the surface flows like a slow liquid.',
    '  vec2 w = 0.06 * vec2(',
    '    field(uv * 3.0 + vec2(t * 0.18, -t * 0.10)),',
    '    field(uv * 3.0 + vec2(-t * 0.08, t * 0.16)));',
    '  // Chromatic aberration — light bends through the surface: sample the',
    '  // background at RGB-offset UVs along a slowly drifting distortion vector.',
    '  // Kept deliberately small (0.004) so edges refract without rainbow fringing.',
    '  vec2 ca = 0.004 * vec2(sin(t * 0.7), cos(t * 0.6));', 
    '  float r = field((uv + ca + w) * 3.0);',
    '  float g = field((uv + w) * 3.0);',
    '  float b = field((uv - ca + w) * 3.0);',
    '  vec3 irid = palette(mix(r, b, 0.5) * 0.6 + g * 0.4 + 0.12);',
    '  // Constrained accent weight: <= 0.15 in dark, ~0.06 in light — the glass',
    '  // stays near the theme base (deep slate / off-white) instead of washing',
    '  // the whole screen in color.',
    '  vec3 base = uDark > 0.5 ? vec3(0.020, 0.026, 0.050) : vec3(0.970, 0.972, 0.978);',
    '  vec3 col = mix(base, irid, uDark > 0.5 ? 0.15 : 0.06);', 
    '  // Specular sheen: light glides across the surface like glass.',
    '  float sheen = 0.09 * pow(1.0 - abs(p.y + 0.30 * sin(uv.x * 4.0 + t * 0.5)), 3.0);',
    '  sheen += 0.045 * pow(1.0 - abs(p.x - 0.30 * cos(t * 0.4)), 6.0);',
    '  col += vec3(1.0) * sheen;',
    '  // Faint surface shimmer so the glass never reads as static.',
    '  col *= 0.94 + 0.06 * vnoise(uv * 10.0 + t * 0.7);',
    '  // Vignette: edges recede so the app floats above the glass.',
    // edge order kept portable (GLSL ES 1.00: smoothstep(edge0 < edge1))
    '  float vig = 1.0 - smoothstep(0.40, 1.30, length(p * vec2(0.9, 1.0)));',
    '  col *= mix(0.62, 1.0, vig);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  // ---- INTEGRATED-STRUCTURE-API-WINDOW plan §2: mouse-tracking glow ----
  // The plan's GlossyBackground tracks the cursor via CSS custom properties
  // (--mouse-x / --mouse-y) and renders a radial `.mouse-glow` overlay that
  // follows it. Adaptation: while the premium engine is active, a lightweight
  // fixed-position glow div sits ABOVE the liquid canvas but BELOW the app
  // content (z-index 0, later in DOM than #glass-canvas; #app-main is z1),
  // and a rAF-throttled mousemove listener writes the custom properties onto
  // <html> so the glow follows the cursor. The listener + element live only
  // for the premium session — deactivate()/fallback remove both, keeping the
  // zero-cost-when-off gate intact (verified by qa-glass.cjs).
  let _glowEl = null;
  let _glowRaf = 0;

  function _onMouseMove(e) {
    if (_glowRaf) return;
    _glowRaf = requestAnimationFrame(function() {
      _glowRaf = 0;
      const de = document.documentElement;
      if (!de) return;
      de.style.setProperty('--mouse-x', e.clientX + 'px');
      de.style.setProperty('--mouse-y', e.clientY + 'px');
    });
  }

  function _mountGlow() {
    if (_glowEl) return;
    const el = document.createElement('div');
    el.className = 'mouse-glow';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el); // after #glass-canvas → paints above it
    _glowEl = el;
    window.addEventListener('mousemove', _onMouseMove, { passive: true });
  }

  function _unmountGlow() {
    if (_glowRaf) { cancelAnimationFrame(_glowRaf); _glowRaf = 0; }
    window.removeEventListener('mousemove', _onMouseMove);
    if (_glowEl && _glowEl.parentNode) _glowEl.parentNode.removeChild(_glowEl);
    _glowEl = null;
  }

  function _frame() {
    if (!_state.active || !_state.renderer) return;
    try {
      _state.uniforms.uTime.value = _state.clock.getElapsedTime();
      _state.renderer.render(_state.scene, _state.camera);
      _state.rafId = requestAnimationFrame(_frame);
    } catch (e) {
      // A render exception must never crash the app — fall back to CSS.
      deactivate();
      if (ns.Errors && ns.Errors.log) ns.Errors.log('glass: render error, back to CSS', 'glass');
    }
  }

  // PERF (owner 2026-08-15): the premium engine keeps pumping frames even
  // when the tab is hidden — a full-viewport WebGL shader burning GPU for a
  // page nobody is looking at. Pause the loop on visibilitychange and resume
  // it when the tab comes back; the mouse-glow RAF is cancelled the same way
  // (its mousemove listener still re-arms it, which is fine while hidden).
  function _onVisibility() {
    if (!_state.active) return;
    if (document.hidden || document.visibilityState === 'hidden') {
      if (_state.rafId) { cancelAnimationFrame(_state.rafId); _state.rafId = 0; }
    } else if (!_state.rafId) {
      _frame();
    }
  }

  function _onResize() {
    if (!_state.active || !_state.renderer) return;
    try {
      _state.renderer.setSize(window.innerWidth, window.innerHeight);
      _state.uniforms.uRes.value.set(window.innerWidth, window.innerHeight);
    } catch (e) { /* resize is cosmetic */ }
    // Shared detection: resize into a narrow viewport must tear the engine
    // down (same signal that switches dense layouts to simplified cards).
    if (ns.Viewport && ns.Viewport.effectiveGlassMode() !== 'premium') sync();
  }

  // Activate the premium engine. Returns a Promise<boolean> so callers (and
  // the QA gate) can await the outcome. Every failure path resolves false
  // and leaves the app on CSS glass.
  async function activate() {
    if (_state.active) return true;
    if (!ns.Viewport || ns.Viewport.effectiveGlassMode() !== 'premium') return false;
    let THREE = null;
    try {
      THREE = await _importThree();
    } catch (err) {
      _fallback('three-load', err);
      return false;
    }
    try {
      const canvas = document.createElement('canvas');
      canvas.id = 'glass-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      document.body.appendChild(canvas);
      _mountGlow(); // mouse-tracking glow above the canvas, below the app
      const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: false, antialias: false, powerPreference: 'high-performance' });
      // PERF (owner 2026-08-15): cap the render scale at 1.25 instead of 1.5 —
      // a 44% fragment reduction on high-DPI screens with no perceptible
      // softness for a blurred backdrop; the shader is the single most
      // expensive thing on the page, and the owner's machine lagged with it on.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      renderer.setSize(window.innerWidth, window.innerHeight);
      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      camera.position.z = 1;
      const geo = new THREE.PlaneGeometry(2, 2);
      const uniforms = {
        uTime: { value: 0 },
        uRes: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        uDark: { value: (document.body.classList.contains('dark-mode') ? 1 : 0) },
        uCyan: { value: (document.documentElement.getAttribute('data-theme') === 'cyan' ? 1 : 0) }
      };
      const mat = new THREE.ShaderMaterial({ uniforms: uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      // WebGL context loss must not strand a zombie canvas — tear down.
      canvas.addEventListener('webglcontextlost', function(e) {
        e.preventDefault();
        _state.ctxLost = true;
        deactivate();
      }, false);
      _state = { active: true, renderer: renderer, scene: scene, camera: camera, mesh: mesh, uniforms: uniforms, clock: new THREE.Clock(), canvas: canvas, rafId: 0, ctxLost: false };
      window.addEventListener('resize', _onResize);
      document.addEventListener('visibilitychange', _onVisibility);
      document.body.classList.add('glass-premium');
      _frame();
      if (ns.App && ns.App.showToast) ns.App.showToast('Premium liquid-glass mode on — toggle off in Settings to return to CSS glass.', 'ok');
      return true;
    } catch (err) {
      _fallback('webgl', err);
      return false;
    }
  }

  function _fallback(why, err) {
    _unmountGlow();
    try {
      if (_state.canvas && _state.canvas.parentNode) _state.canvas.parentNode.removeChild(_state.canvas);
    } catch (e) { /* ignore */ }
    document.body.classList.remove('glass-premium');
    if (ns.Errors && ns.Errors.log) ns.Errors.log('glass: premium unavailable (' + why + ') — CSS glass stays on', 'glass');
    if (ns.App && ns.App.showToast) ns.App.showToast('Premium glass unavailable on this device — CSS glass stays on.', 'err');
    _state = freshState();
  }

  // 3.5.5 shared teardown: dispose renderer + force WebGL context loss so a
  // mode toggle never leaks GPU contexts. Idempotent and never throws.
  function deactivate() {
    if (!_state.active && !_state.renderer) return;
    _unmountGlow();
    if (_state.rafId) cancelAnimationFrame(_state.rafId);
    window.removeEventListener('resize', _onResize);
    document.removeEventListener('visibilitychange', _onVisibility);
    try {
      if (_state.renderer) {
        const gl = _state.renderer.getContext && _state.renderer.getContext();
        _state.renderer.dispose();
        if (gl && gl.getExtension) {
          const ext = gl.getExtension('WEBGL_lose_context');
          if (ext && ext.loseContext) ext.loseContext();
        }
      }
    } catch (e) { /* teardown is best-effort */ }
    try {
      if (_state.canvas && _state.canvas.parentNode) _state.canvas.parentNode.removeChild(_state.canvas);
    } catch (e) { /* ignore */ }
    document.body.classList.remove('glass-premium');
    _state = freshState();
  }

  // The single re-check entry point — called on boot, on the settings
  // toggle, and from showSection() so the shared viewport signal drives
  // both layout simplification and the glass engine (plan §2).
  function sync() {
    const mode = (ns.Viewport && ns.Viewport.effectiveGlassMode) ? ns.Viewport.effectiveGlassMode() : 'css';
    if (mode === 'premium' && !_state.active) {
      activate();
    } else if (mode !== 'premium' && _state.active) {
      deactivate();
    }
  }

  // Theme change: update the shader's dark + palette flags without a full
  // reload (uCyan follows <html data-theme> so premium glass respects the
  // active palette, exactly like uDark follows body.dark-mode).
  function refreshTheme() {
    if (_state.active && _state.uniforms) {
      _state.uniforms.uDark.value = (document.body.classList.contains('dark-mode') ? 1 : 0);
      _state.uniforms.uCyan.value = (document.documentElement.getAttribute('data-theme') === 'cyan' ? 1 : 0);
    }
  }

  ns.Glass = {
    THREE_CDN: THREE_CDN,
    active: active,
    activate: activate,
    deactivate: deactivate,
    sync: sync,
    refreshTheme: refreshTheme,
    _importThree: _importThree
  };
})(MMGR);
window.MMGR = MMGR;
