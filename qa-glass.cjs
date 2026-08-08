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
const CHROME = 'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe';
const PORT = 9242;
const BASE = 'http://127.0.0.1:8765';
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
    var cardRule = rules.filter(function(r){ return r.selectorText && r.selectorText.indexOf('.card') === 0 && r.selectorText.indexOf('glass') === -1; })[0];
    return { hasBackdrop: !!cardRule && /backdrop-filter/.test(cardRule.style.cssText),
      premiumClassOff: !document.body.classList.contains('glass-premium'),
      canvasAbsent: !document.getElementById('glass-canvas') };
  })()`);
  check('G02 css-glass: .card carries the backdrop-filter recipe by default, premium inert on boot', g1.hasBackdrop && g1.premiumClassOff && g1.canvasAbsent, g1);

  // ---- 3.5.2 capability detection ---------------------------------------
  // Force high-end via the documented test hook, set pref premium.
  const c1 = await ev(`(function(){
    window.__mmgrForceHighEnd = true;
    window.MMGR.Viewport.setGlassMode('premium');
    return { highEnd: window.MMGR.Viewport.isHighEnd(), pref: window.MMGR.Viewport.getGlassMode(), eff: window.MMGR.Viewport.effectiveGlassMode() };
  })()`);
  check('G03 detect: high-end + premium pref -> effective premium', c1.highEnd && c1.pref === 'premium' && c1.eff === 'premium', c1);

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
  const n1 = await ev(`(function(){
    window.__mmgrGlassImportCalls = 0;
    window.MMGR.Viewport.setGlassMode('css');
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
      disposed: window.__glassDisposed, lost: window.__glassLost };
  })()`);
  check('G08 teardown: deactivate -> renderer.dispose + WEBGL_lose_context, canvas removed', !t1.active && !t1.cls && !t1.canvas && t1.disposed === 1 && t1.lost === 1, t1);

  // Toggle on/off repeatedly — dispose count must track activations exactly
  // (one context created per activate, one disposed per deactivate: no leak).
  const t2 = await ev(`(async function(){
    var beforeDisposed = window.__glassDisposed;
    for (var i = 0; i < 4; i++) {
      var a = await window.MMGR.Glass.activate();
      if (!a) return { fail: 'activate ' + i };
      window.MMGR.Glass.deactivate();
    }
    return { disposed: window.__glassDisposed - beforeDisposed, active: window.MMGR.Glass.active(), canvas: !!document.getElementById('glass-canvas') };
  })()`);
  check('G09 teardown: 4 on/off cycles -> 4 disposes, 0 active, 0 canvas left (no leak)', t2.disposed === 4 && !t2.active && !t2.canvas, t2);

  // Settings-toggle path: real checkbox click flips the pref and sync()s.
  // Convention (verified in qa-r3): Chrome flips checkbox `checked` BEFORE
  // the delegated handler runs, so a SINGLE click from the visually-current
  // state is the action — pre-setting checked would double-flip and cancel.
  const u1 = await ev(`(function(){
    window.__mmgrForceHighEnd = true;
    window.MMGR.Viewport.setGlassMode('css');
    var tgl = document.getElementById('glass-tgl');
    if (!tgl) return { missing: true };
    tgl.checked = false;          // visual state == stored css
    tgl.click();                  // click flips -> checked true -> handler reads true
    return { pref: window.MMGR.Viewport.getGlassMode(), eff: window.MMGR.Viewport.effectiveGlassMode() };
  })()`);
  await delay(250);
  const u2 = await ev(`(function(){ return window.MMGR.Glass.active(); })()`);
  check('G10 toggle: checkbox on -> pref premium + effective premium + engine active', u1 && !u1.missing && u1.pref === 'premium' && u1.eff === 'premium' && u2 === true, { u1, u2 });

  // Back off via the real click path (now checked=true; one click flips off).
  await ev(`(function(){ document.getElementById('glass-tgl').click(); return true; })()`);
  await delay(250);
  const u3 = await ev(`(function(){ return { active: window.MMGR.Glass.active(), pref: window.MMGR.Viewport.getGlassMode() }; })()`);
  check('G11 toggle: checkbox off -> engine disposed, pref css', u3.active === false && u3.pref === 'css', u3);

  // Preference is device-level, not project state (never in the export).
  const u4 = await ev(`(function(){
    var s = window.MMGR.State.getState();
    return { inState: s.glassMode !== undefined || s.glassPref !== undefined, ls: localStorage.getItem('mmgr_glass_mode') };
  })()`);
  check('G12 pref: glass mode lives in the device slot, NOT project state', u4.inState === false && u4.ls === 'css', u4);

  // Reset for other gates.
  await ev(`(function(){ localStorage.removeItem('mmgr_glass_mode'); window.__mmgrForceHighEnd = undefined; return true; })()`);

  const failed = results.filter(r => !r.val);
  log('GLASS35_GATE ' + (failed.length === 0 ? 'PASS' : 'FAIL (' + failed.length + ' broken)'));
  proc.kill(); process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
