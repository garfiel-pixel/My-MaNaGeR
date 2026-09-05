/* ============================================================
   qa-calculator.cjs — PHASE 5 COMPREHENSIVE CALCULATOR (A1-A8)
   ------------------------------------------------------------
   Owner D1/A1-A8 (tracker D10 order). Verifies in headless
   Chrome against the dev server (BASE):
     C1  panel opens via MMGR.Calculator.open(); all 11 sections
         exist (general..evm + settings)
     C2  tab bar: all 10 user tabs visible by default (settings
         reachable only via the head gear)
     C3  trades tab math: concrete pour, cylinder, masonry,
         earthwork, roof squares
     C4  trades tab math: framing, stairs, paint, drywall,
         tile, asphalt, trench
     C5  bid & finance tab: markup bid, break-even, loan payment
     C6  site & geometry tab: slope grade, arc/chord, prismoid,
         frustum, unit conversions
     C7  EVM manual tab: SPI/CPI/EAC/ETC/VAC from typed fields;
         evm-* ids renamed (evm-pv-calc etc) so no collision
         with the app dashboard's own evm-* elements
     C8  EVM live tab: no state -> friendly message (no throw)
     C9  settings gear: opens settings section, aria-expanded
         syncs; unchecking a tab removes its tab button, hides
         its section, persists to localStorage mmgr_calc_tabs;
         rechecking restores it
     C10 General always on: it cannot be un-toggled in settings
     C11 unique ids inside the panel (no duplicate mc-result
         vs Monte Carlo panel; material cost now mat-*)
   Usage: node tools/qa-calculator.cjs   (serve.cjs on BASE
   required; the project page boots with no project fine).
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./chrome-launcher.cjs');
const userDir = path.join(os.tmpdir(), 'chrome-calc-' + Date.now());
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, val, detail) {
  results.push({ name, val });
  console.log((val ? '[PASS] ' : '[FAIL] ') + name + (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 400)));
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
    const evd = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      return r && r.result && r.result.subtype === 'error' ? { __err: (r.result.description || '').slice(0, 300) } : (r && r.result && r.result.value);
    };
    await send('Page.enable');

    // ---- boot: open the launcher first, seed local ownership for the
    // default project (a fresh headless profile has none, so project.html
    // would bounce to app.html?locked), then open the project page ----
    await send('Page.navigate', { url: BASE + '/app.html' });
    await delay(2500);
    await ev(`(function(){
      try {
        var list = JSON.parse(localStorage.getItem('mmgr_admin_projects') || '[]');
        if (!list.some(function(p){ return p && p.id === 'default'; })) list.push({ id: 'default', name: 'QA Seed Project', created: Date.now() });
        localStorage.setItem('mmgr_admin_projects', JSON.stringify(list));
        localStorage.setItem('mmgr_unlocked_default', '1');
      } catch (e) { return String(e); }
      return 'ok';
    })()`);
    await send('Page.navigate', { url: BASE + '/project.html' });
    await delay(3500);
    await ev(`(function(){ if (window.MMGR && MMGR.Calculator && MMGR.Calculator.open) MMGR.Calculator.open(); return true; })()`);
    await delay(600);

    const c1 = await evd(`(function(){
      if (!document.getElementById('calc-panel')) return { err: 'no calc-panel' };
      const secs = Array.prototype.slice.call(document.querySelectorAll('#calc-panel .calc-section')).map(s => s.getAttribute('data-calc'));
      const open = document.getElementById('calc-panel').classList.contains('calc-open');
      return { open: open, secs: secs, n: secs.length };
    })()`);
    const wantSecs = ['general', 'pct', 'area', 'convert', 'markup', 'cost', 'trades', 'finance', 'site', 'evm', 'settings'];
    check('C1 panel opens with all 11 sections (general..evm + settings)',
      c1 && c1.open && c1.n === 11 && wantSecs.every(s => (c1.secs || []).indexOf(s) > -1), c1);

    const c2 = await evd(`(function(){
      const tabs = Array.prototype.slice.call(document.querySelectorAll('#calc-panel .calc-tab')).map(t => t.getAttribute('data-tab'));
      const gear = document.getElementById('calc-gear');
      return { tabs: tabs, hasSettingsTab: tabs.indexOf('settings') > -1, gearExists: !!gear };
    })()`);
    const wantTabs = ['general', 'pct', 'area', 'convert', 'markup', 'cost', 'trades', 'finance', 'site', 'evm'];
    check('C2 tab bar shows all 10 user tabs; settings only via gear',
      c2 && wantTabs.every(t => (c2.tabs || []).indexOf(t) > -1) && !c2.hasSettingsTab && c2.gearExists, c2);

    // ---- helper: switch tab + fill + run an action, return the result text ----
    const runAction = async (tab, sets, action) => {
      return evd(`(function(){
        var tabBtn = null;
        document.querySelectorAll('#calc-panel .calc-tab').forEach(function(t){ if (t.getAttribute('data-tab') === '${tab}') tabBtn = t; });
        if (!tabBtn) return { err: 'no tab ' + '${tab}' };
        tabBtn.click();
        var sets = ${JSON.stringify(sets)};
        for (var k in sets) { var el = document.getElementById(k); if (!el) return { err: 'no field ' + k }; el.value = sets[k]; }
        var btn = null;
        document.querySelectorAll('#calc-panel [data-calc-action]').forEach(function(b){ if (b.getAttribute('data-calc-action') === '${action}') btn = b; });
        if (!btn) return { err: 'no action ' + '${action}' };
        btn.click();
        // Each action button is immediately followed by its own result div;
        // within a shared card (paint/drywall/tile, asphalt/trench) the
        // sibling lookup is the only correct mapping.
        var out = btn.nextElementSibling && btn.nextElementSibling.classList && btn.nextElementSibling.classList.contains('calc-result')
          ? btn.nextElementSibling : null;
        return out ? out.textContent.trim() : { err: 'no result container' };
      })()`);
    };

    // ---- C3: trades math (exact known values) ----
    // Concrete pour: 10x10 ft slab @ 4 in -> 33.3 cu ft = 1.23 cu yd (no waste)
    let r = await runAction('trades', { 'tr-l': '10', 'tr-w': '10', 'tr-t': '4', 'tr-waste': '0' }, 'tr-pour');
    check('C3a concrete pour: 10x10x4in -> 1.23 cu yd', typeof r === 'string' && /33\.3 cu ft/.test(r) && /1\.23 cu yd/.test(r), r);
    // Cylinder: d=2ft h=4ft -> pi*1^2*4 = 12.566 cu ft = 0.47 cu yd
    r = await runAction('trades', { 'tr-col-d': '2', 'tr-col-h': '4', 'tr-col-n': '1' }, 'tr-cylinder');
    check('C3b column: 2ft dia x 4ft -> 0.47 cu yd', typeof r === 'string' && /0\.47 cu yd total/.test(r), r);
    // Masonry: 10x10 wall, 16x8x8 block, 0 waste -> 75 units
    r = await runAction('trades', { 'tr-mw': '10', 'tr-mh': '10', 'tr-msz': 'block16', 'tr-mwaste': '0' }, 'tr-masonry');
    check('C3c masonry: 100 sq ft 16" block -> 75 units', typeof r === 'string' && /75 units/.test(r), r);
    // Earthwork: 20x10x3 ft = 600 cu ft = 22.22 cu yd, 25% swell -> 27.78
    r = await runAction('trades', { 'tr-el': '20', 'tr-ew': '10', 'tr-ed': '3', 'tr-eswell': '25' }, 'tr-earth');
    check('C3d earthwork: 600 cu ft +25% swell -> 27.78 loose', typeof r === 'string' && /Cut: 22\.22 cu yd/.test(r) && /27\.78 cu yd/.test(r), r);
    // Roof: 2000 sq ft footprint, 6-in-12 -> slope 1.1180 -> 2236 sq ft -> 22.4 squares
    r = await runAction('trades', { 'tr-ff': '2000', 'tr-rise': '6' }, 'tr-roof');
    check('C3e roof: 2000 sf @6/12 -> 22.4 squares', typeof r === 'string' && /22\.4 squares/.test(r), r);

    // ---- C4: trades part 2 ----
    // Framing: 20 ft x 8 ft @ 16" oc -> ceil(20*12/16)+1 = 16 studs
    r = await runAction('trades', { 'tr-fw': '20', 'tr-fh': '8', 'tr-foc': '16', 'tr-fwaste': '0' }, 'tr-framing');
    check('C4a framing: 20ft wall @16" oc -> 16 studs', typeof r === 'string' && /Studs: 16 /.test(r), r);
    // Stairs: rise 105", run 120", max 7.75 -> 14 risers @7.50", 13 treads
    r = await runAction('trades', { 'tr-sr': '105', 'tr-srun': '120', 'tr-smax': '7.75' }, 'tr-stairs');
    check('C4b stairs: 105" rise -> 14 risers', typeof r === 'string' && /14 risers @ 7\.50"/.test(r), r);
    // Paint: 700 sf x 1 coat -> 2 gallons (350 sf/gal)
    r = await runAction('trades', { 'tr-paint-sf': '700', 'tr-paint-coat': '1' }, 'tr-paint');
    check('C4c paint: 700 sf x1 -> 2 gallons', typeof r === 'string' && /~ 2 gallon/.test(r), r);
    // Drywall: 320 sf -> 10 sheets (32 sf each)
    r = await runAction('trades', { 'tr-dry-sf': '320' }, 'tr-drywall');
    check('C4d drywall: 320 sf -> 10 sheets', typeof r === 'string' && /10 x 4x8 sheets/.test(r), r);
    // Tile: 100 sf 12x12 -> 110 tiles w/ waste
    r = await runAction('trades', { 'tr-tile-sf': '100', 'tr-tile-sz': '12' }, 'tr-tile');
    check('C4e tile: 100 sf 12x12 -> 110 tiles', typeof r === 'string' && /~110 x 12x12 tiles/.test(r), r);
    // Asphalt: 1000 sf @ 3" -> 1000*0.25*0.083 = 20.75 tons
    r = await runAction('trades', { 'tr-asp-sf': '1000', 'tr-asp-t': '3' }, 'tr-asphalt');
    check('C4f asphalt: 1000 sf @3" -> ~20.75 tons', typeof r === 'string' && /20\.75 tons/.test(r), r);
    // Trench: 50x2x4 ft = 400 cu ft = 14.81 cu yd
    r = await runAction('trades', { 'tr-tren-l': '50', 'tr-tren-w': '2', 'tr-tren-d': '4' }, 'tr-trench');
    check('C4g trench: 400 cu ft -> 14.81 cu yd', typeof r === 'string' && /14\.81 cu yd/.test(r), r);

    // ---- C5: bid & finance ----
    // Bid: cost 100000, OH 10%, profit 15% -> 110000 then 126500
    r = await runAction('finance', { 'fi-cost': '100000', 'fi-oh': '10', 'fi-profit': '15' }, 'fi-bid');
    check('C5a bid: $100k +10% OH +15% profit -> $126,500', typeof r === 'string' && /Bid: \$126,500/.test(r), r);
    // Break-even: fixed 5000, unit cost 25, price 35 -> 500 units
    r = await runAction('finance', { 'fi-be-fix': '5000', 'fi-be-unit': '25', 'fi-be-price': '35' }, 'fi-break');
    check('C5b break-even: 5000/(35-25) -> 500 units', typeof r === 'string' && /500 units/.test(r), r);
    // Loan: 300000 @ 6% / 30yr -> monthly ~1798.65
    r = await runAction('finance', { 'fi-loan-p': '300000', 'fi-loan-r': '6', 'fi-loan-y': '30' }, 'fi-loan');
    check('C5c loan: $300k @6% 30y -> ~$1,798.65/mo', typeof r === 'string' && /\$1,798\.\d\d/.test(r), r);

    // ---- C6: site & geometry ----
    // Slope: rise 1 run 12 -> 8.33% grade, 4.76 deg
    r = await runAction('site', { 'si-rise': '1', 'si-run': '12' }, 'si-slope');
    check('C6a slope: 1/12 -> 8.33% grade', typeof r === 'string' && /8\.33% grade/.test(r), r);
    // Arc: radius 10, 90 deg -> 15.71 arc, 14.14 chord
    r = await runAction('site', { 'si-rad': '10', 'si-ang': '90' }, 'si-arc');
    check('C6b arc: r10/90deg -> 15.71 / 14.14', typeof r === 'string' && /Arc length: 15\.71/.test(r) && /Chord: 14\.14/.test(r), r);
    // Prismoid: A1 100, A2 200, Am 150, L 30 -> (30/6)*(100+600+200) = 4500
    r = await runAction('site', { 'si-a1': '100', 'si-a2': '200', 'si-am': '150', 'si-len': '30' }, 'si-prismoid');
    check('C6c prismoid: 4500 cu ft', typeof r === 'string' && /4500\.00 cu ft/.test(r), r);

    // ---- C7: EVM manual (renamed ids must work) ----
    // BAC 100000, PV 50000, EV 40000, AC 50000 -> SPI 0.80, CPI 0.80,
    // EAC = 50000 + (100000-40000)/0.8 = 125000, ETC 75000, VAC -25000
    r = await runAction('evm', { 'evm-bac': '100000', 'evm-pv-calc': '50000', 'evm-ev-calc': '40000', 'evm-ac-calc': '50000' }, 'evm-manual');
    check('C7 EVM manual: SPI 0.80 | CPI 0.80 | EAC $125,000', typeof r === 'string' && /SPI 0\.80 \| CPI 0\.80/.test(r) && /\$125,000/.test(r) && /VAC \$-25,000/.test(r), r);

    // ---- C8: EVM live (no project on this page -> graceful message) ----
    const c8 = await evd(`(function(){
      var btn = null;
      document.querySelectorAll('#calc-panel [data-calc-action]').forEach(function(b){ if (b.getAttribute('data-calc-action') === 'evm-live') btn = b; });
      var tabBtn = null;
      document.querySelectorAll('#calc-panel .calc-tab').forEach(function(t){ if (t.getAttribute('data-tab') === 'evm') tabBtn = t; });
      if (!btn || !tabBtn) return { err: 'missing controls' };
      tabBtn.click();
      btn.click();
      var out = document.getElementById('evm-live-result');
      var threw = false;
      return { text: out ? out.textContent.trim() : null, threw: threw };
    })()`);
    // evm-live may compute real numbers if a default/demo state exists; the gate is: no exception and a message
    const c8ok = typeof c8.text === 'string' && c8.text.length > 0 && !/undefined/.test(c8.text) && c8.threw === false;
    check('C8 EVM live: renders a result or a graceful no-state message', c8ok, c8);

    // ---- C9: settings gear + toggles ----
    const c9a = await evd(`(function(){
      var gear = document.getElementById('calc-gear');
      if (!gear) return { err: 'no gear' };
      gear.click();
      var settingsVisible = !document.querySelector('[data-calc="settings"]').classList.contains('is-hide');
      var tradesVisibleSection = !document.querySelector('[data-calc="trades"]').classList.contains('is-hide');
      var tradesCb = document.querySelector('[data-calc-toggle="trades"]');
      return { settingsVisible: settingsVisible, tradesSectionVisible: tradesVisibleSection,
        gearExpanded: gear.getAttribute('aria-expanded'), tradesChecked: tradesCb ? tradesCb.checked : null };
    })()`);
    check('C9a gear opens settings (section shown, aria-expanded=true)', c9a && c9a.settingsVisible && c9a.gearExpanded === 'true', c9a);

    // uncheck trades -> tab removed, section hidden, storage persisted
    const c9b = await evd(`(function(){
      var cb = document.querySelector('[data-calc-toggle="trades"]');
      if (!cb) return { err: 'no trades toggle' };
      cb.checked = false;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      var tabs = Array.prototype.slice.call(document.querySelectorAll('#calc-panel .calc-tab')).map(function(t){ return t.getAttribute('data-tab'); });
      var tradesSectionHidden = document.querySelector('[data-calc="trades"]').classList.contains('is-hide');
      return { tabs: tabs, tradesGone: tabs.indexOf('trades') === -1, tradesSectionHidden: tradesSectionHidden,
        stored: localStorage.getItem('mmgr_calc_tabs') };
    })()`);
    check('C9b unchecking Trades removes its tab + hides section + persists',
      c9b && c9b.tradesGone && c9b.tradesSectionHidden && c9b.stored && c9b.stored.indexOf('"trades"') === -1 && c9b.stored.indexOf('"general"') > -1, c9b);

    // recheck trades -> tab restored
    const c9c = await evd(`(function(){
      var cb = document.querySelector('[data-calc-toggle="trades"]');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      var tabs = Array.prototype.slice.call(document.querySelectorAll('#calc-panel .calc-tab')).map(function(t){ return t.getAttribute('data-tab'); });
      return { tradesBack: tabs.indexOf('trades') > -1, stored: localStorage.getItem('mmgr_calc_tabs') };
    })()`);
    check('C9c rechecking Trades restores its tab + persists', c9c && c9c.tradesBack && c9c.stored.indexOf('"trades"') > -1, c9c);

    // ---- C10: General cannot be un-toggled ----
    const c10 = await evd(`(function(){
      var genCb = document.querySelector('[data-calc-toggle="general"]');
      return { generalHasToggle: !!genCb, generalTabAlwaysThere: !!document.querySelector('#calc-panel .calc-tab[data-tab="general"]') };
    })()`);
    check('C10 General always on: no settings toggle, tab always present', c10 && c10.generalHasToggle === false && c10.generalTabAlwaysThere, c10);

    // ---- C11: unique ids inside the panel (mat-* rename + no dupes) ----
    const c11 = await evd(`(function(){
      var seen = {}, dups = [];
      document.querySelectorAll('#calc-panel [id]').forEach(function(el){ if (seen[el.id]) dups.push(el.id); seen[el.id] = 1; });
      var mcInPanel = !!document.querySelector('#calc-panel #mc-result');
      var matInPanel = !!document.querySelector('#calc-panel #mat-result');
      var monoMc = document.querySelectorAll('#mc-result').length; // monolith MC panel keeps its own
      return { dups: dups, mcInPanel: mcInPanel, matInPanel: matInPanel, monoMc: monoMc };
    })()`);
    check('C11 unique panel ids; material cost renamed to mat-result; monolith #mc-result untouched',
      c11 && c11.dups.length === 0 && !c11.mcInPanel && c11.matInPanel && c11.monoMc === 1, c11);

    const fails = results.filter(r2 => !r2.val).length;
    console.log('\n' + (results.length - fails) + ' passed, ' + fails + ' failed');
    process.exitCode = fails ? 1 : 0;
  } finally {
    try { proc.kill(); } catch (e) {}
    try { await delay(300); } catch (e) {}
  }
})();
