/* ============================================================
   Gate-screen theme × glass matrix pass (closes the MARKETING
   plan's gate-screen [VERIFY] item).

   Drives the two access gates — app.html (launcher unlock modal)
   and admin.html (password setup + login gates) — across:
     glass pref : css | premium (mmgr_glass_mode + __mmgrForceHighEnd)
     theme      : light | dark  (dark = forced .dark-mode class,
                  the same class the app's theme logic applies —
                  neither gate page has its own theme control)
   and reports whether either gate EVER looks broken: console
   errors, invisible/low-contrast text, layout overflow, gate
   rect escaping the viewport. Saves one screenshot per combo.

   Run: node tools/verify-gates-themes.cjs
   ============================================================ */
const { spawn } = require('child_process');
const fs = require('fs');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9336;
const ROOT = 'C:/Users/Garfield/Downloads/mymanager-fixed';
const userDir = 'C:/tmp/chrome-gates-' + Date.now();

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- Node-side color/contrast math (for the verdict pass) ---- */
function parseColor(str) {
  const m = String(str).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map(s => parseFloat(s.trim()));
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
function blend(fg, bg) {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}
function lum(c) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function contrast(fg, bg) {
  const l1 = lum(fg), l2 = lum(bg);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-allow-origins=*', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + userDir, '--window-size=1280,900', 'about:blank'
], { stdio: 'ignore' });

async function waitForPageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await r.json();
      const page = list.find(t => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('CDP page target did not come up');
}

(async function () {
  const wsUrl = await waitForPageTarget();
  const ws = new WebSocket(wsUrl);
  await new Promise(r => { ws.onopen = r; });

  let id = 0;
  const pending = new Map();
  const consoleIssues = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method === 'Runtime.exceptionThrown') {
      consoleIssues.push('EXC: ' + ((msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description) || msg.params.exceptionDetails.text).slice(0, 180));
    }
    else if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
      consoleIssues.push(msg.params.type.toUpperCase() + ': ' + (msg.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 180));
    }
  };
  const send = (method, params) => new Promise(resolve => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.error) return 'CDP_ERROR:' + JSON.stringify(r.error);
    if (r.result && r.result.exceptionDetails) return 'EXC:' + ((r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description) || r.result.exceptionDetails.text);
    return r.result && r.result.result ? r.result.result.value : null;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await sleep(600);

  /* ---- in-page check: sample the gate's computed look + contrast ---- */
  const CHECK_SRC = `(function(){
    function parseColor(str){
      var m=String(str).match(/rgba?\\(([^)]+)\\)/); if(!m) return null;
      var p=m[1].split(',').map(function(s){return parseFloat(s.trim());});
      return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};
    }
    function blend(fg,bg){var a=fg.a;return {r:fg.r*a+bg.r*(1-a),g:fg.g*a+bg.g*(1-a),b:fg.b*a+bg.b*(1-a),a:1};}
    function lum(c){function f(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
      return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);}
    function contrast(fg,bg){var l1=lum(fg),l2=lum(bg);var hi=Math.max(l1,l2),lo=Math.min(l1,l2);return (hi+0.05)/(lo+0.05);}
    function effBg(el){
      var cs=getComputedStyle(el); var c=parseColor(cs.backgroundColor);
      if(!c) return null;
      var bodyBg=parseColor(getComputedStyle(document.body).backgroundColor)||{r:255,g:255,b:255,a:1};
      return blend(c,bodyBg);
    }
    function sample(el){
      var cs=getComputedStyle(el); var bg=effBg(el); var fg=parseColor(cs.color);
      if(!bg||!fg) return null;
      return {sel:el.id?('#'+el.id):(el.tagName+'.'+(el.className||'').toString().split(' ')[0]),
        ratio:+contrast(fg,bg).toFixed(2), fg:cs.color, bg:cs.backgroundColor};
    }
    var out={};
    var gate = \${GATE_SEL};
    if(gate){
      var cs=getComputedStyle(gate);
      var r=gate.getBoundingClientRect();
      out.gate={cls:gate.className.toString().slice(0,60),
        display:cs.display, bg:cs.backgroundColor, border:cs.borderColor+' '+cs.borderWidth,
        radius:cs.borderRadius, shadow:cs.boxShadow.slice(0,70),
        backdrop:cs.backdropFilter,
        top:Math.round(r.top), bottom:Math.round(r.bottom), h:Math.round(r.height),
        inView: r.top>=0 && r.bottom<=window.innerHeight};
      out.samples=[];
      \${SAMPLE_SEL}
    } else { out.gate=null; out.samples=[]; }
    out.page={vpw:window.innerWidth, vph:window.innerHeight,
      scrollW:document.documentElement.scrollWidth,
      overflow: document.documentElement.scrollWidth>window.innerWidth+1,
      darkClass: document.body.classList.contains('dark-mode'),
      glassPremiumClass: document.body.classList.contains('glass-premium'),
      canvasCount: document.querySelectorAll('canvas').length};
    return JSON.stringify(out);
  })()`;

  function preload(glass, adminLogin) {
    let s = "try{localStorage.setItem('mmgr_glass_mode','" + glass + "');}catch(e){}";
    if (glass === 'premium') s += "try{window.__mmgrForceHighEnd=true;}catch(e){}";
    if (adminLogin) s += "try{localStorage.setItem('mmgr_admin_pass_hash','seedhash');}catch(e){}";
    return s;
  }

  const passes = [];
  async function pass(name, file, opts) {
    const pre = await send('Page.addScriptToEvaluateOnNewDocument', { source: preload(opts.glass, opts.adminLogin) });
    const startIdx = consoleIssues.length;
    await send('Page.navigate', { url: 'file:///' + ROOT + '/' + file });
    await sleep(opts.waitMs || 3200);
    if (opts.dark) await evaluate("document.body.classList.add('dark-mode'); true");
    let click = null;
    if (file === 'app.html') {
      click = await evaluate(`(function(){
        var cards=document.querySelectorAll('.pcard');
        if(!cards.length){ document.getElementById('om').classList.add('open'); return 'forced-open (no cards)'; }
        var locked=document.querySelector('.pcard:not(.unlocked)');
        if(locked){ locked.click(); return 'clicked-locked-card'; }
        document.getElementById('om').classList.add('open'); return 'forced-open (all unlocked)';
      })()`);
      await sleep(500);
    }
    const raw = await evaluate(CHECK_SRC.replace('${GATE_SEL}', opts.gateSel).replace('${SAMPLE_SEL}', opts.sampleSel));
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = { parseError: String(raw).slice(0, 200) }; }
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const png = 'tools/gate-' + name + '.png';
    if (shot.result && shot.result.data) fs.writeFileSync(png, Buffer.from(shot.result.data, 'base64'));
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: pre.identifier });
    await sleep(250);
    const rec = { name, file, glass: opts.glass, dark: !!opts.dark, click, issues: consoleIssues.slice(startIdx), ...parsed, screenshot: png };
    passes.push(rec);
    console.log('PASS ' + name + ' done');
    return rec;
  }

  const sample = (gateSel, selList) =>
    '[' + selList.map(s => JSON.stringify(s)).join(',') + '].forEach(function(s){' +
    'var e=' + gateSel + '.querySelector(s); if(e){var r=sample(e); if(r) out.samples.push(r);}});';

  const appGate = "document.querySelector('#om.open .mb')";
  const adminGate = "document.querySelector('.gbox')";

  // ---- app.html launcher unlock modal: 2 glass × 2 themes ----
  await pass('app-light-css', 'app.html', { glass: 'css', dark: false, gateSel: appGate, sampleSel: sample(appGate, ['#om-title-text', '#om-desc', '#code-input', '#unlock-btn']) });
  await pass('app-dark-css', 'app.html', { glass: 'css', dark: true, gateSel: appGate, sampleSel: sample(appGate, ['#om-title-text', '#om-desc', '#code-input', '#unlock-btn']) });
  await pass('app-light-premium', 'app.html', { glass: 'premium', dark: false, gateSel: appGate, sampleSel: sample(appGate, ['#om-title-text', '#om-desc', '#code-input', '#unlock-btn']) });
  await pass('app-dark-premium', 'app.html', { glass: 'premium', dark: true, gateSel: appGate, sampleSel: sample(appGate, ['#om-title-text', '#om-desc', '#code-input', '#unlock-btn']) });

  // ---- admin.html password SETUP gate: 2 glass × 2 themes ----
  await pass('admin-setup-light-css', 'admin.html', { glass: 'css', dark: false, gateSel: adminGate, sampleSel: sample(adminGate, ['h1', 'p', 'input', 'button']) });
  await pass('admin-setup-dark-css', 'admin.html', { glass: 'css', dark: true, gateSel: adminGate, sampleSel: sample(adminGate, ['h1', 'p', 'input', 'button']) });
  await pass('admin-setup-light-premium', 'admin.html', { glass: 'premium', dark: false, gateSel: adminGate, sampleSel: sample(adminGate, ['h1', 'p', 'input', 'button']) });
  await pass('admin-setup-dark-premium', 'admin.html', { glass: 'premium', dark: true, gateSel: adminGate, sampleSel: sample(adminGate, ['h1', 'p', 'input', 'button']) });

  // ---- admin.html LOGIN gate (returning admin): representative combos ----
  await pass('admin-login-light-css', 'admin.html', { glass: 'css', dark: false, adminLogin: true, gateSel: adminGate, sampleSel: sample(adminGate, ['h1', 'p', 'input', 'button']) });
  await pass('admin-login-dark-premium', 'admin.html', { glass: 'premium', dark: true, adminLogin: true, gateSel: adminGate, sampleSel: sample(adminGate, ['h1', 'p', 'input', 'button']) });

  /* ---- verdicts ---- */
  const rows = passes.map(p => {
    const flags = [];
    const info = [];
    const errors = p.issues.filter(i => i.startsWith('EXC') || i.startsWith('ERROR'));
    const warns = p.issues.filter(i => i.startsWith('WARN'));
    if (errors.length) flags.push('CONSOLE-ERRORS');
    if (p.page && p.page.overflow) flags.push('H-OVERFLOW');
    if (p.gate && !p.gate.inView) flags.push('GATE-OUT-OF-VIEW');
    let worst = 99;
    if (p.samples && p.samples.length) worst = Math.min(...p.samples.map(s => s.ratio));
    if (worst < 1.25) flags.push('INVISIBLE-TEXT(' + worst.toFixed(2) + ')');
    else if (worst < 3) flags.push('LOW-CONTRAST(' + worst.toFixed(2) + ')');
    if (!p.gate) flags.push('NO-GATE-FOUND');
    // Informational only: the premium engine is not loaded on launcher/gate
    // pages, so premium preference + capability legitimately changes nothing.
    if (p.glass === 'premium' && p.page && p.page.canvasCount === 0) info.push('premium-engine-not-on-page');
    return {
      combo: p.name, glass: p.glass, theme: p.dark ? 'dark' : 'light', screen: p.click || 'n/a',
      worstContrast: worst === 99 ? null : +worst.toFixed(2),
      errors: errors.length, warnings: warns.length,
      gate: p.gate ? p.gate.cls : null,
      broken: flags.length > 0,
      verdict: flags.length ? flags.join(' | ') : (info.length ? 'OK (' + info.join(', ') + ')' : 'OK')
    };
  });

  const summary = {
    note: 'app.html and admin.html do not load the Liquid Glass engine (mmgr-glass.js/mmgr-viewport.js) nor any theme reader. Premium = localStorage mmgr_glass_mode=premium + __mmgrForceHighEnd; dark = forced .dark-mode class (the class the app theme logic uses).',
    rows,
    anyBroken: rows.some(r => r.broken)
  };
  fs.writeFileSync('tools/gate-matrix-report.json', JSON.stringify(summary, null, 2));
  console.log('\n===== MATRIX REPORT =====');
  console.log(JSON.stringify(summary, null, 2));
  console.log('RESULT:', summary.anyBroken ? 'BROKEN STATES FOUND' : 'NO BROKEN STATES');
  proc.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e && e.stack || e); proc.kill(); process.exit(1); });
