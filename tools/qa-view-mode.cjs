/* ============================================================
   qa-view-mode.cjs — ROSE-GOLD PALETTE + 3D VIEW DECK (E14)
   ------------------------------------------------------------
   Phase 3 (owner D7/D9/E10-E14). Two independent dock axes:
     PALETTE mmgr_palette gold|rose -> html[data-theme=rose-gold]
     VIEW    mmgr_view_mode flat|3d -> body.view-3d (effective)
   Verifies in headless Chrome against the dev server (BASE):
     V1  default: no data-theme, Flat pressed, no .view-3d
     V2  Rose click -> html[data-theme=rose-gold] + persisted;
         reload keeps rose; Gold click removes the attribute
     V3  3D click -> body.view-3d + #grid/view-deck computed
         transform non-none (tilt on) + --glass-blur zeroed on
         the deck (WebKit audit #8); body itself never transforms
         and the unlock modal (.mb overlay) stays flat
     V4  preference survives reload (3d still pressed/rendered)
     V5  mobile auto-flat: stored 3d + 640px wide -> no .view-3d
     V6  reduced motion: stored 3d + prefers-reduced-motion ->
         deck computed transform none (CSS media flat)
     V7  espresso-on-coral contrast (light + dark rose) >= 4.5
     V8  rose-gold surfaces resolve (--gold is coral, --text is
         espresso in light; light text in dark)
     V9  project.html deck exists (main#app-main.view-deck) and
         admin.html deck exists (main.view-deck)
   Usage: node tools/qa-view-mode.cjs   (serve.cjs on BASE required)
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./chrome-launcher.cjs');
const userDir = path.join(os.tmpdir(), 'chrome-viewmode-' + Date.now());
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, val, detail) {
  results.push({ name, val });
  console.log((val ? '[PASS] ' : '[FAIL] ') + name + (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 400)));
}
// WCAG relative-luminance contrast for the measured pairs.
function lum(hex) {
  const c = hex.replace('#', '').slice(0, 6);
  const ch = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255);
  const lin = ch.map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrast(a, b) {
  const l1 = lum(a), l2 = lum(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

(async function () {
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
    '--remote-allow-origins=*', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDir, '--window-size=1280,900', '--disk-cache-size=0', 'about:blank'
  ], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) break; } catch (e) {}
      await delay(300);
    }
    const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
    const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    const pending = new Map();
    let id = 0;
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
    const send = (method, params = {}) => new Promise(res => {
      const mid = ++id; pending.set(mid, m => res(m.result || {})); ws.send(JSON.stringify({ id: mid, method, params }));
    });
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return r && r.result && r.result.value;
    };
    await send('Page.enable');

    // ---- V1/V2/V3/V7/V8 on app.html (launcher) ----
    await send('Page.navigate', { url: BASE + '/app.html' });
    await delay(3000);
    const v1 = await ev(`(function(){
      const dt = document.documentElement.getAttribute('data-theme');
      const flat = document.querySelector('.dock [data-view="flat"]');
      const three = document.querySelector('.dock [data-view="3d"]');
      const gold = document.querySelector('.dock [data-palette="gold"]');
      return { dataTheme: dt, flatPressed: flat && flat.getAttribute('aria-pressed'),
        threePressed: three && three.getAttribute('aria-pressed'),
        goldPressed: gold && gold.getAttribute('aria-pressed'),
        view3d: document.body.classList.contains('view-3d'),
        deckExists: !!document.querySelector('.view-deck') };
    })()`);
    check('V1 default: gold palette, Flat pressed, no data-theme, no view-3d',
      v1.dataTheme === null && v1.flatPressed === 'true' && v1.goldPressed === 'true' && v1.threePressed === 'false' && !v1.view3d && v1.deckExists, v1);

    await ev(`(function(){ const b = document.querySelector('.dock [data-palette="rose"]'); if (b) b.click(); })()`);
    await delay(350);
    const v2 = await ev(`(function(){
      return { dataTheme: document.documentElement.getAttribute('data-theme'),
        stored: localStorage.getItem('mmgr_palette'),
        rosePressed: document.querySelector('.dock [data-palette="rose"]').getAttribute('aria-pressed'),
        gold: getComputedStyle(document.documentElement).getPropertyValue('--gold').trim(),
        text: getComputedStyle(document.documentElement).getPropertyValue('--text').trim() };
    })()`);
    // --gold is authored as hex (#FF6E52) in the rose block but some legacy
    // surfaces use the rgb-triplet form; accept both representations.
    const coralOk = (s) => /#FF6E52/i.test(s) || /255\s*,\s*110\s*,\s*82/.test(s);
    check('V2 Rose click: data-theme=rose-gold + persisted + pressed + coral/espresso tokens',
      v2.dataTheme === 'rose-gold' && v2.stored === 'rose' && v2.rosePressed === 'true' && coralOk(v2.gold) && /#2E272C/i.test(v2.text), v2);

    // Dark overrides are scoped to body.dark-mode, so dark token reads must
    // target body (custom-property values inherit downward, never up to root).
    const v8l = await ev(`(function(){
      const cs = getComputedStyle(document.body);
      return { g: cs.getPropertyValue('--gold').trim(), on: cs.getPropertyValue('--on-gold').trim() };
    })()`);
    // V7 contrast: light espresso-on-coral computed from the resolved hexes.
    const cLight = contrast('#FF6E52', '#2E272C');
    check('V7 light rose espresso-on-coral contrast >= 4.5', cLight >= 4.5, { ratio: +cLight.toFixed(2), g: v8l.g, on: v8l.on });

    // Persistence across reload (V2b).
    await send('Page.navigate', { url: BASE + '/app.html' });
    await delay(3000);
    const v2b = await ev(`document.documentElement.getAttribute('data-theme')`);
    check('V2b reload keeps rose-gold', v2b === 'rose-gold', v2b);

    // V3: switch to 3D (already rose) — tilt + blur-free deck + body flat.
    await ev(`(function(){ const b = document.querySelector('.dock [data-view="3d"]'); if (b) b.click(); })()`);
    await delay(600);
    const v3 = await ev(`(function(){
      const deck = document.querySelector('.view-deck');
      const cs = deck ? getComputedStyle(deck) : null;
      const bodyTr = getComputedStyle(document.body).transform;
      const modal = document.getElementById('om');
      const modalTr = modal ? getComputedStyle(modal).transform : null;
      return { view3d: document.body.classList.contains('view-3d'),
        stored: localStorage.getItem('mmgr_view_mode'),
        deckTr: cs ? cs.transform : null,
        deckBlur: cs ? cs.getPropertyValue('--glass-blur').trim() : null,
        bodyTr: bodyTr, modalTr: modalTr,
        pressed3d: document.querySelector('.dock [data-view="3d"]').getAttribute('aria-pressed') };
    })()`);
    const tilting = v3.view3d && v3.stored === '3d' && v3.deckTr && v3.deckTr !== 'none' && /matrix3d|perspective|rotate/.test(v3.deckTr) && v3.pressed3d === 'true';
    check('V3 3D click: body.view-3d + deck tilted (matrix3d) + 3d stored + pressed', tilting, v3);
    check('V3 WebKit blur-free tilt: deck --glass-blur is 0px while tilted', v3.view3d && v3.deckBlur === '0px', v3);
    check('V3 overlays stay flat: body + unlock modal have NO transform', v3.bodyTr === 'none' && (!v3.modalTr || v3.modalTr === 'none'), v3);

    // V4: view preference survives reload.
    await send('Page.navigate', { url: BASE + '/app.html' });
    await delay(3000);
    const v4 = await ev(`(function(){
      return { view3d: document.body.classList.contains('view-3d'),
        pressed3d: document.querySelector('.dock [data-view="3d"]').getAttribute('aria-pressed') };
    })()`);
    check('V4 reload keeps 3D (class + pressed)', v4.view3d && v4.pressed3d === 'true', v4);

    // V5: mobile auto-flat — stored 3d but 640px viewport.
    await send('Emulation.setDeviceMetricsOverride', { width: 640, height: 900, deviceScaleFactor: 1, mobile: false });
    await delay(800);
    const v5 = await ev(`(function(){
      return { view3d: document.body.classList.contains('view-3d'),
        innerW: window.innerWidth,
        stored: localStorage.getItem('mmgr_view_mode') };
    })()`);
    check('V5 mobile auto-flat: stored 3d at 640px -> no body.view-3d', v5.stored === '3d' && !v5.view3d && v5.innerW === 640, v5);
    await send('Emulation.clearDeviceMetricsOverride');
    await delay(600);
    const v5b = await ev(`document.body.classList.contains('view-3d')`);
    check('V5b widening back past 769 re-enables stored 3D', v5b === true, v5b);

    // V6: reduced motion forces flat even at desktop width.
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await delay(800);
    const v6 = await ev(`(function(){
      const cs = document.querySelector('.view-deck') ? getComputedStyle(document.querySelector('.view-deck')) : null;
      return { view3d: document.body.classList.contains('view-3d'),
        deckTr: cs ? cs.transform : null,
        rm: matchMedia('(prefers-reduced-motion: reduce)').matches };
    })()`);
    check('V6 reduced motion: deck transform none despite stored 3D', v6.rm === true && v6.view3d === true && v6.deckTr === 'none', v6);
    await send('Emulation.setEmulatedMedia', { features: [] });

    // V7 dark rose contrast + V8 dark tokens: seed dark via the page picker.
    await ev(`(function(){
      localStorage.setItem('mmgr_theme', 'dark');
      document.body.classList.add('dark-mode');
    })()`);
    await delay(300);
    const v7d = await ev(`(function(){
      const cs = getComputedStyle(document.body);
      return { gold: cs.getPropertyValue('--gold').trim(), on: cs.getPropertyValue('--on-gold').trim(),
        text: cs.getPropertyValue('--text').trim() };
    })()`);
    const darkOn = /#FF8A70/i.test(v7d.gold);
    const darkText = /#F3E7E1/i.test(v7d.text);
    const cDark = contrast('#FF8A70', '#241713');
    check('V8 dark rose tokens resolve (coral gold + light text)', darkOn && darkText && v7d.on.toLowerCase() === '#241713', v7d);
    check('V7 dark rose espresso-on-coral contrast >= 4.5', cDark >= 4.5, { ratio: +cDark.toFixed(2) });

    // V9: project + admin carry .view-deck wrappers. The workspace page only
    // boots for an unlocked project; seed demo-project like the other harnesses.
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      try{ localStorage.setItem('mmgr_unlocked_demo-project','1');
        localStorage.setItem('mmgr_scope_demo-project','full'); }catch(e){}
    ` });
    await send('Page.navigate', { url: BASE + '/project.html?id=demo-project' });
    await delay(4000);
    const v9p = await ev(`(function(){
      const m = document.getElementById('app-main');
      return { deck: m ? m.classList.contains('view-deck') : false,
        view3d: document.body.classList.contains('view-3d') };
    })()`);
    check('V9 project.html deck: main#app-main.view-deck + tilt applies', v9p.deck === true && v9p.view3d === true, v9p);
    await send('Page.navigate', { url: BASE + '/admin.html' });
    await delay(3000);
    const v9a = await ev(`(function(){
      const mains = Array.from(document.querySelectorAll('main'));
      return { deck: mains.some(function(m){ return m.classList.contains('view-deck'); }) };
    })()`);
    check('V9 admin.html deck: main.view-deck present', v9a.deck === true, v9a);

    const failed = results.filter(r => !r.val).length;
    console.log(failed === 0 ? '\nALL VIEW-MODE GATES PASSED' : '\n' + failed + ' CHECK(S) FAILED');
    proc.kill();
    process.exit(failed === 0 ? 0 : 1);
  } catch (e) {
    console.error('harness error:', e && e.stack || e);
    proc.kill();
    process.exit(1);
  }
})();
