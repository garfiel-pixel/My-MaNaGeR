/* ============================================================
   RANK 3.5 GATE — Dual-Engine Glass UI (Premium/CSS)
   (PLAN-OF-ACTION-LIQUID-GLASS-UI)
   Drives headless Chrome against http://127.0.0.1:8765.
   Covers:
     - 3.5.1 CSS glass is the universal default (.glass-panel
       recipe on .card) with zero JS/opt-in.
     - 3.5.2 Capability floor: a simulated LOW-END profile stays
       CSS-only regardless of any stored 'premium' preference —
       preference never overrides genuine incapability.
     - 3.5.3 Settings toggle: single labeled checkbox, off by
       default, persisted to the shared device slot; never a popup.
     - 3.5.4 Premium engine: Three.js fetched from the pinned CDN
       via dynamic import ONLY when detection + toggle allow. The
       hard gate: with the toggle off, ZERO import calls (zero
       network). The real import seam is stubbed in-page with a
       fake THREE module so activate()/deactivate() lifecycle is
       verified deterministically.
     - 3.5.5 Shared teardown: switching Premium -> CSS (or a
       resize into a narrow viewport) disposes the renderer and
       forces WebGL context loss — no leaked contexts on repeated
       toggling. Verified via the fake renderer's dispose/loseCount.
     - Shared detection (plan §2): the same signal that decides
       simplified-vs-full layout also gates the glass engine.
   Exit 0 only when every contract holds.
   Usage: node qa-glass.cjs  (server must be on :8765)
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./tools/chrome-launcher.cjs');
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-glass-' + Date.now());
let ws, msgId = 0;
const pending = new Map();
const results = [];
const log = (s) => { process.stdout.write('[glass35] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG'); try { ws && ws.close(); } catch (e) {} process.exit(2); }, 300000);
function send(method, params) { return new Promise(res => { const id = ++msgId; pending.set(id, m => { pending.delete(id); res(m.result || {}); }); ws.send(JSON.stringify({ id, method, params: params || {} })); }); }
async function ev(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text }; return r.result && r.result.value; }

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) break; } catch (e) {} await delay(300); }
  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: BASE + '/seed-test.html' }); await delay(4000);

  const check = (name, val, detail) => { results.push({ name, val, detail }); log((val ? 'PASS' : 'FAIL') + ' ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail))); };

  // ---- 0. boot: modules present + pinned CDN verified at implementation ----
  const b1 = await ev(`(function(){
    return { glass: !!window.MMGR.Glass, viewport: !!window.MMGR.Viewport,
      cdn: window.MMGR.Glass && window.MMGR.Glass.THREE_CDN,
      pinned: /unpkg\\.com\\/three@\\d+\\.\\d+\\.\\d+\\/build\\/three\\.module\\.js/.test(window.MMGR.Glass ? window.MMGR.Glass.THREE_CDN : '') };
  })()`);
  check('G01 boot: Glass module + Viewport present, CDN pinned to real three URL', !!(b1.glass && b1.viewport && b1.pinned), b1);

  // 3.5.1: CSS glass default — .card uses the glass recipe (blur var present
  // in the rule), zero JS class needed, no premium class on boot.
  const g1 = await ev(`(function(){
    var rules = Array.prototype.slice.call(document.styleSheets).reduce(function(a, sh){ try { return a.concat(Array.prototype.slice.call(sh.cssRules)); } catch(e){ return a; } }, []);
    // Match the BASE .card rule exactly — '.card.blueprint' (launcher polish)
    // and other compound selectors precede it in the sheet and carry no
    // backdrop-filter, so a prefix scan picks the wrong rule (G02 drift fix,
    // 2026-09-03).
    var cardRule = rules.filter(function(r){
      return r.selectorText && r.selectorText.split(',').some(function(s){ return s.trim() === '.card'; });
    })[0];
    return { hasBackdrop: !!cardRule && /backdrop-filter/.test(cardRule.style.cssText),
      // OWNER 2026-09-06: premium glass is the DEFAULT on capable devices.
      // Headless Chromium ships SwiftShader WebGL, so the capability floor
      // passes and the engine boots unprompted: body class + canvas present.
      premiumOn: document.body.classList.contains('glass-premium'),
      canvasPresent: !!document.getElementById('glass-canvas') };
  })()`);
  check('G02 premium-default: .card keeps the CSS recipe AND the engine boots by default on capable devices', g1.hasBackdrop && g1.premiumOn && g1.canvasPresent, g1);

  // ---- 3.5.2 capability detection ---------------------------------------
  // Force high-end via the documented test hook, set pref premium. Perf is
  // turned OFF here too (owner 2026-09-06): heavy layers require it.
  const c1 = await ev(`(function(){
    window.__mmgrForceHighEnd = true;
    window.MMGR.Viewport.setGlassMode('premium');
    localStorage.setItem('mmgr_perf_mode', 'off');
    return { highEnd: window.MMGR.Viewport.isHighEnd(), pref: window.MMGR.Viewport.getGlassMode(), eff: window.MMGR.Viewport.effectiveGlassMode() };
  })()`);
  check('G03 detect: high-end + premium pref (+ perf off) -> effective premium', c1.highEnd && c1.pref === 'premium' && c1.eff === 'premium', c1);

  // G03b (owner 2026-09-06, revised): Performance Mode no longer gates the
  // shader - the starry glass is mandatory app identity, self-gated by the
  // capability floor. This gate now pins that separation: perf mode must
  // NEVER flip the glass decision (shader on = shader on, either way).
  const c1b = await ev(`(function(){
    localStorage.setItem('mmgr_perf_mode', 'on');
    var effPerfOn = window.MMGR.Viewport.effectiveGlassMode();
    localStorage.setItem('mmgr_perf_mode', 'off');
    var effPerfOff = window.MMGR.Viewport.effectiveGlassMode();
    localStorage.setItem('mmgr_perf_mode', 'on'); // restore Performance Mode ON
    return { effPerfOn: effPerfOn, effPerfOff: effPerfOff };
  })()`);
  check('G03b perf-mode: Performance Mode does not gate the shader (premium stays premium either way)', c1b.effPerfOn === 'premium' && c1b.effPerfOff === 'premium', c1b);

  // Capability floor: force low-end while pref stays premium -> CSS wins.
  const c2 = await ev(`(function(){
    window.__mmgrForceHighEnd = false;
    var eff = window.MMGR.Viewport.effectiveGlassMode();
    window.__mmgrForceHighEnd = true;
    return { eff: eff };
  })()`);
  check('G04 detect: low-end profile -> CSS even with stored premium pref (floor overrides)', c2.eff === 'css', c2);

  // Shared detection: narrow viewport + premium pref -> CSS (plan §2).
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await delay(300);
  const c3 = await ev(`(function(){
    return { narrow: window.MMGR.Viewport.isNarrow(), eff: window.MMGR.Viewport.effectiveGlassMode() };
  })()`);
  check('G05 detect: narrow viewport + premium pref -> CSS (shared signal)', c3.narrow && c3.eff === 'css', c3);
  await send('Emulation.clearDeviceMetricsOverride'); await delay(300);

  // ---- 3.5.4 premium engine: zero network until opt-in ------------------
  // Track import calls; with the toggle off, Glass.sync must not import.
  // NOTE (owner 2026-09-06): Performance Mode gates the heavy layers, so
  // these gates turn it OFF for the duration (then restore it).
  const n1 = await ev(`(function(){
    window.__mmgrGlassImportCalls = 0;
    window.MMGR.Viewport.setGlassMode('css');
    localStorage.setItem('mmgr_perf_mode', 'off');
    window.MMGR.Glass.deactivate();
    window.MMGR.Glass.sync();
    return { calls: window.__mmgrGlassImportCalls, active: window.MMGR.Glass.active() };
  })()`);
  await delay(300);
  check('G06 zero-net: toggle off -> sync() makes ZERO three import calls (hard gate)', n1.calls === 0 && n1.active === false, n1);

  // Opt in on a high-end device with a MOCKED THREE module: activate builds
  // a canvas, sets the body class, and starts rendering.
  const n2 = await ev(`(async function(){
    var disposed = 0, lost = 0, renders = 0, sizes = 0;
    window.__glassDisposed = 0; window.__glassLost = 0;
    function FakeCtx(){ this._ext = { loseContext: function(){ window.__glassLost++; } }; }
    FakeCtx.prototype.getExtension = function(){ return this._ext; };
    function FakeRenderer(canvas){
      this.domElement = canvas;
      this.setPixelRatio = function(){};
      this.setSize = function(){ sizes++; };
      this.render = function(){ renders++; };
      this.dispose = function(){ disposed++; window.__glassDisposed++; };
      this.getContext = function(){ return new FakeCtx(); };
    }
    window.__mmgrThreeImport = function(){
      window.__mmgrGlassImportCalls = (window.__mmgrGlassImportCalls || 0) + 1;
      // Real THREE constructors return instances — the mocks must too, or
      // the engine's scene.add()/camera.position writes would throw and the
      // circuit-break would swallow the test. Each returns a fresh object.
      return Promise.resolve({
        WebGLRenderer: FakeRenderer,
        Scene: function(){ return { add: function(){} }; },
        OrthographicCamera: function(){ return { position: { z: 0 } }; },
        PlaneGeometry: function(){ return {}; },
        ShaderMaterial: function(){ return {}; },
        Mesh: function(){ return {}; },
        Vector2: function(){ this.set = function(){}; return this; },
        Clock: function(){ this.getElapsedTime = function(){ return 0.5; }; return this; }
      });
    };
    window.__mmgrForceHighEnd = true;
    window.MMGR.Viewport.setGlassMode('premium');
    localStorage.setItem('mmgr_perf_mode', 'off');
    var ok = await window.MMGR.Glass.activate();
    return { ok: ok, active: window.MMGR.Glass.active(),
      cls: document.body.classList.contains('glass-premium'),
      canvas: !!document.getElementById('glass-canvas'),
      calls: window.__mmgrGlassImportCalls };
  })()`);
  await delay(200);
  check('G07 premium: activate() with mock three -> active + body class + canvas + exactly one import', n2.ok && n2.active && n2.cls && n2.canvas && n2.calls === 1, n2);

  // ---- 3.5.5 shared teardown: no leaked contexts -------------------------
  const t1 = await ev(`(function(){
    window.MMGR.Glass.deactivate();
    return { active: window.MMGR.Glass.active(),
      cls: document.body.classList.contains('glass-premium'),
      canvas: !!document.getElementById('glass-canvas'),
      glow: !!document.querySelector('.mouse-glow'),
      disposed: window.__glassDisposed, lost: window.__glassLost };
  })()`);
  check('G08 teardown: deactivate -> renderer.dispose + WEBGL_lose_context, canvas + mouse-glow removed', !t1.active && !t1.cls && !t1.canvas && !t1.glow && t1.disposed === 1 && t1.lost === 1, t1);

  // Toggle on/off repeatedly — dispose count must track activations exactly
  // (one context created per activate, one disposed per deactivate: no leak).
  // Performance Mode stays OFF for these cycles (restored after G12).
  const t2 = await ev(`(async function(){
    var beforeDisposed = window.__glassDisposed;
    for (var i = 0; i < 4; i++) {
      var a = await window.MMGR.Glass.activate();
      if (!a) return { fail: 'activate ' + i };
      window.MMGR.Glass.deactivate();
    }
    return { disposed: window.__glassDisposed - beforeDisposed, active: window.MMGR.Glass.active(), canvas: !!document.getElementById('glass-canvas'), glow: !!document.querySelector('.mouse-glow') };
  })()`);
  check('G09 teardown: 4 on/off cycles -> 4 disposes, 0 active, 0 canvas + 0 mouse-glow left (no leak)', t2.disposed === 4 && !t2.active && !t2.canvas && !t2.glow, t2);

  // Settings-toggle path (owner 2026-09-06): the checkbox UI is retired;
  // Performance Mode now owns the heavy-layer decision. This gate verifies
  // the PREFERENCE path directly (setGlassMode + effectiveGlassMode) with
  // Performance Mode off, replacing the old #glass-tgl click dance.
  const u1 = await ev(`(function(){
    window.__mmgrForceHighEnd = true;
    window.MMGR.Viewport.setGlassMode('css');
    localStorage.setItem('mmgr_perf_mode', 'off');
    return { pref: window.MMGR.Viewport.getGlassMode(), eff: window.MMGR.Viewport.effectiveGlassMode() };
  })()`);
  await ev(`(function(){
    window.MMGR.Viewport.setGlassMode('premium');
    window.MMGR.Glass.sync();
    return true;
  })()`);
  await delay(250);
  const u2 = await ev(`(function(){ return window.MMGR.Glass.active(); })()`);
  check('G10 toggle: premium pref (+ perf off) -> effective premium + engine active', u1 && u1.pref === 'css' && u1.eff === 'css' && u2 === true, { u1, u2 });

  // Back off via the preference path (setGlassMode('css') + sync).
  await ev(`(function(){ window.MMGR.Viewport.setGlassMode('css'); window.MMGR.Glass.sync(); return true; })()`);
  await delay(250);
  const u3 = await ev(`(function(){ return { active: window.MMGR.Glass.active(), pref: window.MMGR.Viewport.getGlassMode() }; })()`);
  check('G11 toggle: css pref -> engine disposed, pref css', u3.active === false && u3.pref === 'css', u3);

  // Preference is device-level, not project state (never in the export).
  const u4 = await ev(`(function(){
    var s = window.MMGR.State.getState();
    return { inState: s.glassMode !== undefined || s.glassPref !== undefined, ls: localStorage.getItem('mmgr_glass_mode') };
  })()`);
  check('G12 pref: glass mode lives in the device slot, NOT project state', u4.inState === false && u4.ls === 'css', u4);

  // Reset for other gates.
  await ev(`(function(){ localStorage.removeItem('mmgr_glass_mode'); localStorage.setItem('mmgr_perf_mode', 'on'); window.__mmgrForceHighEnd = undefined; return true; })()`);

  const failed = results.filter(r => !r.val);
  log('GLASS35_GATE ' + (failed.length === 0 ? 'PASS' : 'FAIL (' + failed.length + ' broken)'));
  proc.kill(); process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
