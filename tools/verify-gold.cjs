#!/usr/bin/env node
/* ============================================================
   tools/verify-gold.cjs - T-GOLD gate (GOLD-1, REFINEMENT-DIRECTIVE-2026-10-24 section 5)
   ------------------------------------------------------------
   The directive asked for four things a machine can check, and this file is
   the machine. Every arm is a claim the directive makes; none of them is
   taken on trust.

   ARM 1  STATIC  no old orange survives outside the allow-list.
          Scans css/*.css for #d96b27, #c25a1b, #a84a15, #f97316 and the
          `217, 107, 39` triple. Comments are stripped first (a comment that
          quotes a colour is documentation, not paint). Every allowed hit is
          an explicit anchor with the reason it is still orange, and the gate
          FAILS if an allowed anchor has disappeared - a stale allow-list is
          how an exception quietly becomes a lie.

   ARM 2  STATIC  the two stylesheets carry the SAME gold tokens.
          marketing and app must not drift: the --bullion* values, both
          gradient tokens and --gold-text-on-light are compared byte for byte.

   ARM 3  BROWSER the label is READABLE on every gold button, in both modes.
          The audit sampled the gradient's three STOPS and concluded the label
          "sits near the middle stop". A label is not a point: it spans a
          region, and on a real button the right-hand edge of the text reaches
          the gradient's deep end. So this arm rasterises the COMPUTED
          gradient into a canvas at the button's true size, samples every pixel
          under the text's own bounding box, and takes the WORST one. That is
          what a person actually reads against.
          Measured before the fix: 3.19-3.70:1 on all 13 gold buttons (AA needs
          4.5). The directive's own two-stop narrow-button form measures
          4.83-4.95 at rest and 5.91-6.11 on hover, so it became the default.

   ARM 4  BROWSER gold used as WORDS is readable on the surface it lands on.
          224 rules said `color: var(--gold)` - #d96b27, 3.45:1 on white - and
          they all now read `--gold-text`, which is the deep bronze step on a
          light page and the accent in dark mode. This arm walks every element
          whose computed colour IS that token, composites its real background
          chain, and fails anything under 4.5:1 (3:1 for large text).

   ARM 5  BROWSER `.btn-g` is still GREEN. The owner's rule: green buttons
          stay green. The shared gold rule must never capture them.

   Usage:  node tools/verify-gold.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row.
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[gold] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const results = [];
const pass = name => {
  results.push({ name, ok: true });
  log('PASS  ' + name);
};
const fail = (name, detail) => {
  failed++;
  results.push({ name, ok: false });
  log('FAIL  ' + name + '  <-- ' + JSON.stringify(detail).slice(0, 700));
};
const ok = (name, cond, detail) => (cond ? pass(name) : fail(name, detail));

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ==================================================================
// ARM 1 - no old orange outside the allow-list
// ==================================================================
const BANNED = [
  { label: '#d96b27', re: /#d96b27/gi },
  { label: '#c25a1b', re: /#c25a1b/gi },
  { label: '#a84a15', re: /#a84a15/gi },
  { label: '#f97316', re: /#f97316/gi },
  { label: '217, 107, 39', re: /217\s*,\s*107\s*,\s*39/g }
];

/* Every anchor is (file, exact declaration text, why it is still orange).
   The reason is the audit's, not a shrug: these are the token plumbing the
   owner deliberately kept (a wash on a plain page stays at today's opacity),
   and one dark-mode FAB that must keep its brand orange so its glyph stays
   visible. */
const ALLOW = [
  [
    'css/mmgr.css',
    '--brand: #d96b27',
    'brand orange: the token itself, 331 rules resolve through it'
  ],
  ['css/mmgr.css', '--brand-hover: #c25a1b', 'brand hover step'],
  ['css/mmgr.css', '--brand-subtle: rgba(217, 107, 39, 0.08)', 'subtle brand tint (wash at 0.08)'],
  [
    'css/mmgr.css',
    '--gold: #d96b27',
    'gold FILL alias: a fill, never text (text reads --gold-text)'
  ],
  ['css/mmgr.css', '--gold-rgb: 217, 107, 39', 'rgb triple for the gold wash'],
  ['css/mmgr.css', '--gold-ink: #a84a15', 'the pre-existing gold-as-text step on light surfaces'],
  [
    'css/mmgr.css',
    'background: #d96b27;',
    'body.dark-mode .calc-fab keeps brand orange so the glyph stays visible'
  ],
  ['css/mmgr.css', '--gold-accent: #d96b27', 'hover accent only'],
  ['css/mmgr.css', '--gold-accent-rgb: 217, 107, 39', 'hover accent rgb triple'],
  ['css/marketing.css', '--gold: #d96b27', 'marketing gold FILL'],
  ['css/marketing.css', '--gold-hover: #c25a1b', 'marketing hover step'],
  ['css/marketing.css', '--gold-deep: #a84a15', 'marketing deep step'],
  ['css/marketing.css', '--gold-rgb: 217, 107, 39', 'marketing rgb triple'],
  [
    'css/marketing.css',
    '--hero-glow-1: radial-gradient(120% 90% at 50% -10%, rgba(217, 107, 39, 0.28)',
    'hero glow wash (a light wash behind the hero, opacity unchanged)'
  ]
];

const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));

{
  const hits = [];
  for (const file of ['css/mmgr.css', 'css/marketing.css']) {
    const src = stripComments(read(file));
    src.split(/\r?\n/).forEach((line, i) => {
      BANNED.forEach(b => {
        b.re.lastIndex = 0;
        if (b.re.test(line)) {
          hits.push({ file, line: i + 1, text: line.trim(), token: b.label });
        }
      });
    });
  }
  // a hit is allowed only if its line contains an allow anchor for that file
  const unexplained = hits.filter(
    h => !ALLOW.some(([f, anchor]) => f === h.file && h.text.indexOf(anchor) >= 0)
  );
  ok(
    'no old orange survives outside the documented allow-list',
    unexplained.length === 0,
    unexplained.map(h => h.file + ':' + h.line + ' ' + h.token + ' :: ' + h.text.slice(0, 90))
  );
  // and the allow-list must still be TRUE: every anchor must still exist
  const stale = ALLOW.filter(([file, anchor]) => stripComments(read(file)).indexOf(anchor) < 0);
  ok(
    'every allow-listed orange anchor still exists (no stale exception)',
    stale.length === 0,
    stale
  );
  log(
    '      ' +
      hits.length +
      ' orange declaration(s) in css/, all of them allow-listed with a written reason'
  );
  // a comment that quotes an orange must NOT count as paint (that is the trap
  // this strip exists for: the token comment quotes #d96b27 twice)
  const raw = read('css/mmgr.css');
  ok(
    'comments are not counted as paint (the token comment quotes the hex)',
    raw.indexOf('which is #d96b27') > 0 && stripComments(raw).indexOf('which is #d96b27') < 0
  );
}

// ==================================================================
// ARM 2 - the two stylesheets carry the same gold tokens
// ==================================================================
{
  const TOKENS = [
    '--bullion-light',
    '--bullion',
    '--bullion-dark',
    '--bullion-deep',
    '--bullion-edge',
    '--bullion-ink',
    '--gold-grad',
    '--gold-grad-hover',
    '--gold-text-on-light'
  ];
  const grab = (css, name) => {
    // the FIRST :root definition wins for the comparison (dark-mode blocks
    // legitimately redefine --gold itself)
    const re = new RegExp('^\\s*' + name.replace(/[-]/g, '\\-') + ':\\s*([^;]+);', 'm');
    const m = css.match(re);
    return m ? m[1].trim() : null;
  };
  const app = read('css/mmgr.css');
  const mkt = read('css/marketing.css');
  const drift = TOKENS.filter(t => {
    const a = grab(app, t);
    const b = grab(mkt, t);
    return a === null || b === null || a !== b;
  });
  ok('both stylesheets define every gold token with the SAME value', drift.length === 0, {
    drifting: drift.map(t => ({ token: t, app: grab(app, t), marketing: grab(mkt, t) }))
  });
  ok(
    'the gradient is the two-stop form that measured AA on real labels',
    /--gold-grad:\s*linear-gradient\(135deg,\s*#d4af37\s*0%,\s*#aa771c\s*100%\)/.test(app) &&
      /--gold-grad:\s*linear-gradient\(135deg,\s*#d4af37\s*0%,\s*#aa771c\s*100%\)/.test(mkt),
    { app: grab(app, '--gold-grad'), marketing: grab(mkt, '--gold-grad') }
  );
  ok(
    'gold as words has one semantic token per theme',
    /--gold-text:\s*var\(--gold-text-on-light\)/.test(app) &&
      /--gold-text:\s*var\(--gold-text-on-light\)/.test(mkt) &&
      /--gold-text:\s*var\(--gold\)/.test(app) &&
      /--gold-text:\s*var\(--gold\)/.test(mkt)
  );
  // the swap must be complete: no rule paints gold WORDS with the fill token
  const wordHits = [];
  for (const file of ['css/mmgr.css', 'css/marketing.css']) {
    stripComments(read(file))
      .split(/\r?\n/)
      .forEach((line, i) => {
        // the property must BE `color`, not `border-color` / `outline-color` /
        // `accent-color` - those are borders and native accents, not words.
        if (/(^|[^-\w])color:\s*var\(--gold\)\s*(;|!important)/.test(line)) {
          wordHits.push(file + ':' + (i + 1) + ' ' + line.trim());
        }
      });
  }
  ok('no rule paints gold WORDS with the gold FILL token', wordHits.length === 0, wordHits);
}

// ==================================================================
// ARM 3-5 - the browser arms
// ==================================================================
const MEASURE_BUTTONS = `(function(){
  function lin(c){ c/=255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); }
  function lum(r,g,b){ return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b); }
  function ratio(a,b){ var L1=Math.max(a,b), L2=Math.min(a,b); return (L1+0.05)/(L2+0.05); }
  function parseColor(s){ var m=s.match(/rgba?\\(([^)]+)\\)/); if(!m) return null;
    var p=m[1].split(',').map(parseFloat); return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}; }
  function parseGradient(bg){ if(!bg||bg.indexOf('gradient')<0) return null;
    var re=/(rgba?\\([^)]+\\))\\s*([0-9.]+%)/g,m,out=[];
    while((m=re.exec(bg))) out.push({color:parseColor(m[1]),pos:parseFloat(m[2])/100});
    return out.length?out:null; }
  function measure(el){
    var cs=getComputedStyle(el);
    var r=el.getBoundingClientRect();
    var w=Math.round(r.width), h=Math.round(r.height);
    if(!w||!h) return null;
    var textCol=parseColor(cs.color);
    var stops=parseGradient(cs.backgroundImage);
    var flat=parseColor(cs.backgroundColor);
    var c=document.createElement('canvas'); c.width=w; c.height=h;
    var ctx=c.getContext('2d');
    if(stops){
      var dx=Math.SQRT1_2, dy=Math.SQRT1_2, len=Math.abs(w*dx)+Math.abs(h*dy);
      var g=ctx.createLinearGradient(w/2-dx*len/2, h/2-dy*len/2, w/2+dx*len/2, h/2+dy*len/2);
      stops.forEach(function(s){
        var q=s.color;
        g.addColorStop(s.pos,'rgba('+Math.round(q.r)+','+Math.round(q.g)+','+Math.round(q.b)+','+(q.a===undefined?1:q.a)+')');
      });
      ctx.fillStyle=g;
    } else if(flat && flat.a>0){
      ctx.fillStyle='rgba('+Math.round(flat.r)+','+Math.round(flat.g)+','+Math.round(flat.b)+','+flat.a+')';
    } else { return null; }
    ctx.fillRect(0,0,w,h);
    var range=document.createRange(); range.selectNodeContents(el);
    var tr=range.getBoundingClientRect();
    if(!tr.width||!tr.height) return null;
    var x0=Math.max(0,Math.floor(tr.left-r.left)), x1=Math.min(w,Math.ceil(tr.right-r.left));
    var y0=Math.max(0,Math.floor(tr.top-r.top)), y1=Math.min(h,Math.ceil(tr.bottom-r.top));
    var data=ctx.getImageData(x0,y0,Math.max(1,x1-x0),Math.max(1,y1-y0)).data;
    var textL=lum(textCol.r,textCol.g,textCol.b), worst=99;
    for(var i=0;i<data.length;i+=4){ var q=ratio(textL,lum(data[i],data[i+1],data[i+2])); if(q<worst) worst=q; }
    var fs=parseFloat(cs.fontSize), fw=parseInt(cs.fontWeight,10)||400;
    var large = fs>=18.66 || (fs>=14 && fw>=700);
    return {
      text:(el.textContent||'').trim().slice(0,30),
      cls:(el.className||'').toString().slice(0,40),
      w:w, fs:Math.round(fs*10)/10, fw:fw, large:!!large,
      worst:Math.round(worst*100)/100, need: large?3:4.5,
      color:cs.color, gradient:!!stops
    };
  }
  var out={buttons:[], goldText:[], green:null};
  document.querySelectorAll('.btn-o, .btn-gold, .btn-bullion').forEach(function(el){
    if(el.offsetParent===null) return;
    var m=measure(el);
    if(m) out.buttons.push(m);
  });
  // ARM 4: every element whose computed colour IS the gold-as-words token.
  function effBg(el){
    var layers=[], n=el, gradient=false;
    while(n && n.nodeType===1){
      var cs=getComputedStyle(n);
      if(cs.backgroundImage && cs.backgroundImage!=='none') gradient=true;
      var c=parseColor(cs.backgroundColor);
      if(c && c.a>0) layers.push(c);
      n=n.parentElement;
    }
    var base={r:255,g:255,b:255};
    var htmlBg=parseColor(getComputedStyle(document.documentElement).backgroundColor);
    if(htmlBg && htmlBg.a>0) base=htmlBg;
    for(var i=layers.length-1;i>=0;i--){
      var l=layers[i];
      base={ r:l.r*l.a+base.r*(1-l.a), g:l.g*l.a+base.g*(1-l.a), b:l.b*l.a+base.b*(1-l.a) };
    }
    return {bg:base, gradient:gradient};
  }
  var probe=document.createElement('span');
  probe.style.color='var(--gold-text)';
  document.body.appendChild(probe);
  var token=parseColor(getComputedStyle(probe).color);
  probe.style.color='var(--gold-text-on-dark)';
  var tokenDark=parseColor(getComputedStyle(probe).color);
  probe.remove();
  function matchesToken(c, t){ return t && Math.abs(c.r-t.r)<=1 && Math.abs(c.g-t.g)<=1 && Math.abs(c.b-t.b)<=1; }
  var seen=0;
  document.querySelectorAll('body *').forEach(function(el){
    if(el.offsetParent===null && getComputedStyle(el).position!=='fixed') return;
    var cs=getComputedStyle(el);
    var c=parseColor(cs.color);
    if(!c||!token) return;
    var which = matchesToken(c, token) ? 'on-light' : matchesToken(c, tokenDark) ? 'on-dark' : null;
    if(!which) return;
    var own=(el.textContent||'').trim();
    if(!own) return;
    var e=effBg(el);
    if(e.gradient) return; // a gradient ancestor: contrast is not a single number
    seen++;
    var fs=parseFloat(cs.fontSize), fw=parseInt(cs.fontWeight,10)||400;
    var large = fs>=18.66 || (fs>=14 && fw>=700);
    var q=ratio(lum(c.r,c.g,c.b), lum(e.bg.r,e.bg.g,e.bg.b));
    out.goldText.push({
      text:own.slice(0,30), cls:(el.className||'').toString().slice(0,36),
      tag:el.tagName.toLowerCase(), ratio:Math.round(q*100)/100, token:which,
      need: large?3:4.5, fs:Math.round(fs*10)/10,
      bg:'rgb('+Math.round(e.bg.r)+','+Math.round(e.bg.g)+','+Math.round(e.bg.b)+')'
    });
  });
  out.goldTextCount=seen;
  // ARM 5: green stays green
  var gEl=document.querySelector('.btn-g');
  if(gEl){
    var gcs=getComputedStyle(gEl);
    out.green={bg:gcs.backgroundColor, image:gcs.backgroundImage, color:gcs.color};
  }
  return out;
})()`;

(async () => {
  let srv = null;
  try {
    const h = await fetch(BASE + '/project.html');
    if (!h.ok) throw new Error('not ok');
  } catch (e) {
    log('starting serve.cjs for this run');
    srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 40; i++) {
      await delay(1000);
      try {
        const h = await fetch(BASE + '/project.html');
        if (h.ok) break;
      } catch (err) {
        /* still starting */
      }
    }
  }

  let pw;
  try {
    pw = require('playwright');
  } catch (e) {
    log('SKIP  playwright is not installed: the browser arms cannot run here');
    log('      (CI installs it; locally run `npm i -D playwright` to arm this gate)');
    log('');
    log(
      'RESULT  ' +
        (failed ? failed + ' failed (static arms)' : 'static arms passed, browser arms SKIPPED')
    );
    process.exit(failed ? 1 : 0);
  }

  let executablePath;
  try {
    executablePath =
      require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined;
  } catch (e) {
    executablePath = undefined;
  }
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath,
    args: ['--disk-cache-size=0']
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });

  const PAGES = [
    { url: 'seed+project.html?id=demo-project', seed: true, label: 'project' },
    { url: 'index.html', label: 'index' },
    { url: 'pricing.html', label: 'pricing' },
    { url: 'features.html', label: 'features' },
    { url: 'about.html', label: 'about' },
    { url: 'contact.html', label: 'contact' }
  ];

  const measured = { buttons: 0, goldText: 0 };
  const failures = [];

  try {
    for (const p of PAGES) {
      if (p.seed) {
        await page.goto(BASE + '/seed-test.html', {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });
        await delay(600);
      }
      const url = BASE + '/' + p.url.replace(/^seed\+/, '');
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      await delay(900);

      for (const theme of ['light', 'dark']) {
        await page.evaluate(t => {
          const st = window.MMGR && window.MMGR.State;
          if (st) st.updateState(s => (s.theme = t));
          document.body.classList.toggle('dark-mode', t === 'dark');
        }, theme);
        await delay(350);

        // rest state
        let m = await page.evaluate(MEASURE_BUTTONS);
        measured.buttons += m.buttons.length;
        measured.goldText += m.goldTextCount || 0;
        m.buttons.forEach(b => {
          if (b.worst < b.need) {
            failures.push({
              page: p.label,
              theme,
              state: 'rest',
              text: b.text,
              worst: b.worst,
              need: b.need,
              w: b.w
            });
          }
        });
        m.goldText.forEach(t => {
          if (t.ratio < t.need) {
            failures.push({
              page: p.label,
              theme,
              state: 'gold-as-text',
              text: t.text,
              cls: t.cls,
              tag: t.tag,
              worst: t.ratio,
              need: t.need,
              bg: t.bg
            });
          }
        });

        // ARM 5 on the page that has the green buttons
        if (p.label === 'project' && theme === 'light') {
          ok(
            '.btn-g still computes to the GREEN token (the owner rule: green stays green)',
            !!m.green && m.green.bg === 'rgb(46, 125, 50)' && m.green.image === 'none',
            m.green
          );
        }

        // hover state for the gold buttons: the hover gradient must be readable too
        if (m.buttons.length) {
          const hoverFail = [];
          const count = await page.evaluate(
            () => document.querySelectorAll('.btn-o, .btn-gold').length
          );
          for (let i = 0; i < Math.min(count, 6); i++) {
            const handle = page.locator('.btn-o, .btn-gold').nth(i);
            if ((await handle.count()) === 0) continue;
            const visible = await handle
              .first()
              .isVisible()
              .catch(() => false);
            if (!visible) continue;
            await handle
              .first()
              .hover()
              .catch(() => {});
            await delay(120);
            const h = await page.evaluate(MEASURE_BUTTONS);
            h.buttons.forEach(b => {
              if (b.worst < b.need) {
                hoverFail.push({ text: b.text, worst: b.worst, need: b.need });
              }
            });
            await page.mouse.move(0, 0);
          }
          hoverFail.forEach(f => failures.push({ page: p.label, theme, state: 'hover', ...f }));
        }
      }
    }

    ok('the gate actually measured gold buttons (not an empty sweep)', measured.buttons > 0, {
      buttons: measured.buttons
    });
    ok(
      'every gold button label clears AA on its REAL gradient, light and dark',
      failures.filter(f => f.state === 'rest').length === 0,
      failures.filter(f => f.state === 'rest')
    );
    ok(
      'the hover gradient clears AA too',
      failures.filter(f => f.state === 'hover').length === 0,
      failures.filter(f => f.state === 'hover')
    );
    ok(
      'gold used as WORDS clears AA on the surface it lands on',
      failures.filter(f => f.state === 'gold-as-text').length === 0,
      failures.filter(f => f.state === 'gold-as-text')
    );
    ok('the gold-as-words sweep found real text to measure', measured.goldText > 0, {
      elements: measured.goldText
    });
    log(
      '      measured ' +
        measured.buttons +
        ' gold button label(s) and ' +
        measured.goldText +
        ' gold-as-words element(s) across ' +
        PAGES.length +
        ' page(s), both themes'
    );
  } catch (e) {
    fail('the browser arms ran to completion', String((e && e.message) || e).slice(0, 400));
  } finally {
    await browser.close().catch(() => {});
    if (srv) {
      try {
        srv.kill();
      } catch (e) {
        /* already gone */
      }
    }
  }

  log('');
  log('RESULT  ' + (failed ? failed + ' failed' : 'all checks passed'));
  process.exit(failed ? 1 : 0);
})();
