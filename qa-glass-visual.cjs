/* ============================================================
   GLASS SHADER visual verification — constrained palette.
   Drives headless Chrome against http://127.0.0.1:8765 using the
   REAL pinned Three.js CDN import (unlike qa-glass.cjs's fake
   THREE mock, which only tests lifecycle). Verifies the manager
   contract:
     - Dark base ~ rgb(0.02, 0.026, 0.05) with accent mixed at
       <= 0.15 (was 0.55) — field stays dark, low saturation.
     - Light mode near off-white / light gray, almost no wash.
     - No purple / green / orange color fields anywhere.
     - Reduced chromatic offset (0.004) — edge ring pixels don't
       fringe into saturated rainbow hues.
     - Toggle off still equals pure CSS glass (canvas gone).
   Screenshots are saved to the OS temp dir for the visual record.
   Usage: node qa-glass-visual.cjs  (server must be on :8765)
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('./tools/chrome-launcher.cjs');
const PROFILE = path.join(require('os').tmpdir(), 'mmgr-glass-vis-' + Date.now());
let ws, msgId = 0;
const pending = new Map();
const results = [];
const log = (s) => { process.stdout.write('[gvis] ' + s + '\n'); };
const delay = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { log('WATCHDOG'); try { ws && ws.close(); } catch (e) {} process.exit(2); }, 180000);
function send(method, params) { return new Promise(res => { const id = ++msgId; pending.set(id, m => { pending.delete(id); res(m.result || {}); }); ws.send(JSON.stringify({ id, method, params: params || {} })); }); }
async function ev(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __err: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text }; return r.result && r.result.value; }

// ---- Minimal PNG decoder (8-bit, color types 0/2/6) — no npm deps ----
function decodePng(buf) {
  let off = 8, w = 0, h = 0, ct = 6;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 1;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const row = out.slice(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      let a = raw[p++];
      if (f !== 0) {
        const left = x >= bpp ? row[x - bpp] : 0;
        const up = y > 0 ? out[(y - 1) * stride + x] : 0;
        const ul = (y > 0 && x >= bpp) ? out[(y - 1) * stride + x - bpp] : 0;
        if (f === 1) a = (a + left) & 255;
        else if (f === 2) a = (a + up) & 255;
        else if (f === 3) a = (a + ((left + up) >> 1)) & 255;
        else if (f === 4) {
          const pa = Math.abs(up - ul), pb = Math.abs(left - ul), pc = Math.abs(left + up - 2 * ul);
          a = (a + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul)) & 255;
        }
      }
      row[x] = a;
    }
  }
  return { w, h, ct, data: out };
}

// Scan sampled pixels. Key metrics are chosen to survive dark-frame math:
//  - meanLum: luminance (0..1) — the base depth.
//  - meanDelta: mean (max-min) RGB spread, NOT divided by luminance — a
//    luminance-independent "color wash" measure (HSV saturation explodes on
//    near-black pixels, which is why we don't gate on it for dark frames).
//  - blueShare: % of saturated pixels that are slate-blue [170,255) — proves
//    "cool slate only" and that no competing hue family appeared.
//  - green/purple/orange: forbidden-hue counts among saturated pixels.
// edgeOnly restricts sampling to the outer 6% ring (fringing shows there).
function scan(img, edgeOnly) {
  const bpp = img.ct === 6 ? 4 : img.ct === 2 ? 3 : 1;
  const step = Math.max(2, Math.floor(Math.max(img.w, img.h) / 240));
  let n = 0, lumSum = 0, delSum = 0, nSat = 0, nBlue = 0;
  const bands = { green: 0, purple: 0, orange: 0 };
  const edge = edgeOnly ? 0.06 : 0; // outer 6% ring for the fringing probe
  for (let y = 0; y < img.h; y += step) {
    for (let x = 0; x < img.w; x += step) {
      if (edgeOnly) {
        const nx = x / img.w, ny = y / img.h;
        if (nx > edge && nx < 1 - edge && ny > edge && ny < 1 - edge) continue;
      }
      const i = (y * img.w + x) * bpp;
      const r = img.data[i] / 255, g = img.data[i + 1] / 255, b = img.data[i + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const d = mx - mn;
      const sat = mx === 0 ? 0 : d / mx;
      let hue = -1;
      if (d > 0.004) {
        if (mx === r) hue = 60 * (((g - b) / d) % 6);
        else if (mx === g) hue = 60 * ((b - r) / d + 2);
        else hue = 60 * ((r - g) / d + 4);
        if (hue < 0) hue += 360;
      }
      lumSum += lum; delSum += d; n++;
      if (sat > 0.30) {
        nSat++;
        if (hue >= 170 && hue < 255) nBlue++;
        else if (hue >= 80 && hue < 170) bands.green++;
        else if (hue >= 255 && hue < 320) bands.purple++;
        else if (hue >= 12 && hue < 50) bands.orange++;
      }
    }
  }
  const st = {
    label: (edgeOnly ? 'EDGE-RING' : 'FULL'),
    n, meanLum: +(lumSum / n).toFixed(4),
    meanDelta: +(delSum / n).toFixed(4),
    pctSat: +((100 * nSat) / n).toFixed(3),
    blueShare: nSat ? +((100 * nBlue) / nSat).toFixed(2) : 100,
    greenPct: +((100 * bands.green) / n).toFixed(4),
    purplePct: +((100 * bands.purple) / n).toFixed(4),
    orangePct: +((100 * bands.orange) / n).toFixed(4)
  };
  return st;
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(require('os').tmpdir(), name);
  if (r && r.data) { fs.writeFileSync(p, Buffer.from(r.data, 'base64')); log('screenshot -> ' + p); return decodePng(fs.readFileSync(p)); }
  throw new Error('captureScreenshot failed');
}

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1440,1200', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) break; } catch (e) {} await delay(300); }
  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  const consoleErrors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push((m.params.args || []).map(a => a.value || a.description || '').join(' '));
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('EXCEPTION: ' + (m.params.exceptionDetails && m.params.exceptionDetails.text));
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
  await send('Runtime.enable'); await send('Page.enable');

  const check = (name, val, detail) => { results.push({ name, val, detail }); log((val ? 'PASS' : 'FAIL') + ' ' + name + (val ? '' : '  <-- ' + JSON.stringify(detail))); };

  // seed-test.html seeds a demo project then lands on project.html?id=demo-project
  await send('Page.navigate', { url: BASE + '/seed-test.html' }); await delay(4000);

  // Activate the REAL premium engine (no fake THREE seam), dark mode first.
  const a1 = await ev(`(async function(){
    delete window.__mmgrThreeImport;
    window.__mmgrForceHighEnd = true;
    document.body.classList.add('dark-mode');
    window.MMGR.Viewport.setGlassMode('premium');
    var ok = await window.MMGR.Glass.activate();
    var canvas = document.getElementById('glass-canvas');
    return { ok: ok, active: window.MMGR.Glass.active(), cls: document.body.classList.contains('glass-premium'), canvas: !!canvas };
  })()`);
  check('real engine: premium activate() with live Three import succeeds', !!(a1.ok && a1.active && a1.cls && a1.canvas), a1);

  // Let the render loop paint several frames, then isolate the glass for sampling.
  await delay(2500);
  const iso = await ev(`(function(){
    var c = document.getElementById('glass-canvas');
    if (!c) return { ok: false };
    Array.prototype.forEach.call(document.body.children, function(el){ if (el !== c) el.style.display = 'none'; });
    return { ok: true, w: c.width, h: c.height };
  })()`);
  await delay(500);
  check('isolation: glass canvas present, UI hidden for sampling', iso.ok === true && iso.w > 0, iso);

  const darkImg = await shot('glass-dark.png');
  const darkFull = scan(darkImg, false);
  check('dark: mean luminance near deep base (0.02-0.18) — accent mixed <= 0.15, not 0.55', darkFull.meanLum > 0.02 && darkFull.meanLum < 0.18, darkFull);
  check('dark: color wash subtle — mean RGB spread < 0.10 (was iridescent at 0.55 mix)', darkFull.meanDelta < 0.10, darkFull);
  check('dark: NO green / purple / orange fields (each < 0.5% of pixels)', darkFull.greenPct < 0.5 && darkFull.purplePct < 0.5 && darkFull.orangePct < 0.5, darkFull);
  check('dark: saturated pixels are slate-blue only (>= 90% share)', darkFull.blueShare >= 90, darkFull);
  const darkEdge = scan(darkImg, true);
  check('dark edge ring: no rainbow fringing — mean RGB spread < 0.10 at borders', darkEdge.meanDelta < 0.10, darkEdge);

  // Light mode: near off-white, almost no wash.
  await ev(`(function(){
    document.body.classList.remove('dark-mode');
    window.MMGR.Glass.refreshTheme();
    return true;
  })()`);
  await delay(600);
  const lightFull = scan(await shot('glass-light.png'), false);
  check('light: mean luminance near off-white (> 0.85)', lightFull.meanLum > 0.85, lightFull);
  check('light: mean RGB spread tiny (< 0.06) — almost no color wash', lightFull.meanDelta < 0.06, lightFull);
  check('light: NO green / purple / orange fields (each < 0.5%)', lightFull.greenPct < 0.5 && lightFull.purplePct < 0.5 && lightFull.orangePct < 0.5, lightFull);

  // Toggle off: back to pure CSS glass — canvas gone, body class off.
  const off = await ev(`(function(){
    window.MMGR.Viewport.setGlassMode('css');
    window.MMGR.Glass.sync();
    return { active: window.MMGR.Glass.active(), canvas: !!document.getElementById('glass-canvas'), cls: document.body.classList.contains('glass-premium') };
  })()`);
  await delay(400);
  check('toggle off: canvas removed, body class off — pure CSS glass', off.active === false && !off.canvas && !off.cls, off);

  check('no console errors during real-engine run', consoleErrors.length === 0, consoleErrors);

  const failed = results.filter(r => !r.val);
  log('GLASSVIS ' + (failed.length === 0 ? 'PASS' : 'FAIL (' + failed.length + ' broken)'));
  proc.kill(); process.exit(failed.length === 0 ? 0 : 1);
})().catch(e => { log('FATAL: ' + e.message); process.exit(1); });
