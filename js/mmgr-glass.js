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

  // ---- Shaders: soft liquid-glass gradient blobs + specular sheen ----
  // One full-screen quad, one draw call. Cheap enough for the premium tier
  // and theme-aware (gold/blue/green accents on a near-black or paper base).
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
    'float blob(vec2 p, vec2 c, float r){',
    '  float d = length(p - c);',
    '  return exp(-d * d / (r * r));',
    '}',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uRes;',
    '  vec2 p = uv - 0.5;',
    '  p.x *= uRes.x / max(uRes.y, 1.0);',
    '  float t = uTime * 0.08;',
    '  float b1 = blob(p, vec2(0.35 * cos(t), 0.30 * sin(t * 1.3)), 0.55);',
    '  float b2 = blob(p, vec2(-0.40 * sin(t * 0.9), -0.35 * cos(t * 1.1)), 0.60);',
    '  float b3 = blob(p, vec2(0.50 * sin(t * 0.7 + 1.2), 0.40 * cos(t * 0.8 + 0.5)), 0.45);',
    '  float b4 = blob(p, vec2(-0.20 * cos(t * 1.4 + 2.0), 0.50 * sin(t * 1.2 + 1.0)), 0.40);',
    '  vec3 c1 = vec3(0.73, 0.55, 0.23);',
    '  vec3 c2 = vec3(0.29, 0.51, 0.96);',
    '  vec3 c3 = vec3(0.20, 0.78, 0.55);',
    '  vec3 base = uDark > 0.5 ? vec3(0.035, 0.04, 0.06) : vec3(0.96, 0.96, 0.98);',
    '  vec3 col = base;',
    '  col += c1 * b1 * 0.16;',
    '  col += c2 * b2 * 0.13;',
    '  col += c3 * b3 * 0.10;',
    '  col += vec3(0.55, 0.30, 0.60) * b4 * 0.08;',
    '  float sheen = 0.06 * pow(1.0 - abs(p.y + 0.35 * sin(uv.x * 6.0 + uTime * 0.2)), 2.0);',
    '  col += vec3(1.0) * sheen;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

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
      const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: false, antialias: false, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(window.innerWidth, window.innerHeight);
      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
      camera.position.z = 1;
      const geo = new THREE.PlaneGeometry(2, 2);
      const uniforms = {
        uTime: { value: 0 },
        uRes: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        uDark: { value: (document.body.classList.contains('dark-mode') ? 1 : 0) }
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
    if (_state.rafId) cancelAnimationFrame(_state.rafId);
    window.removeEventListener('resize', _onResize);
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

  // Theme change: update the shader's dark flag without a full reload.
  function refreshTheme() {
    if (_state.active && _state.uniforms) {
      _state.uniforms.uDark.value = (document.body.classList.contains('dark-mode') ? 1 : 0);
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
