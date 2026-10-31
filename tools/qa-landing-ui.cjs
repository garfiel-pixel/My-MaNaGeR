#!/usr/bin/env node
/* tools/qa-landing-ui.cjs - acceptance gate for UI-FIXES-SPEC.md (landing page, index.html)
   -------------------------------------------------------------------------------------
   One check per spec item (U-02 .. U-14). Every check measures the RENDERED page in a real
   browser; none of them reads source text. On the commit the spec was written against
   (6cdc5e5) almost all of them FAIL - that is the point: they fail for the reasons the spec
   names, and go green as each item lands.

   Usage:  node serve.cjs &            (separate shell)
           node tools/qa-landing-ui.cjs [--only U-07,U-09]
   Env:    QA_BASE (default http://127.0.0.1:8765), QA_CHANNEL (e.g. 'chrome')
   Needs:  playwright. Works on an unbuilt tree (it serves css/marketing.css when
           dist/marketing.min.css is missing).                                            */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:8765';
const ROOT = process.env.QA_ROOT || path.resolve(__dirname, '..');
const only = (process.argv.find(a => a.startsWith('--only=')) || '')
  .replace('--only=', '')
  .split(',')
  .filter(Boolean);
const results = [];
function check(id, label, cond, detail) {
  if (only.length && !only.includes(id)) return;
  results.push({ id, label, ok: !!cond });
  console.log(
    (cond ? 'PASS  ' : 'FAIL  ') +
      id +
      '  ' +
      label +
      (detail !== undefined ? '   [' + detail + ']' : '')
  );
}

async function newPage(browser, opts) {
  const ctx = await browser.newContext(
    Object.assign({ viewport: { width: 1440, height: 900 } }, opts || {})
  );
  const page = await ctx.newPage();
  // Unbuilt tree: dist/marketing.min.css is a build output. Serve the source stylesheet instead.
  await page.route('**/dist/marketing.min.css', async route => {
    let res = null;
    try {
      res = await route.fetch();
    } catch (e) {
      /* fall through */
    }
    if (res && res.status() === 200) return route.fulfill({ response: res });
    const css = fs.readFileSync(path.join(ROOT, 'css/marketing.css'), 'utf8');
    return route.fulfill({ status: 200, contentType: 'text/css', body: css });
  });
  return { ctx, page };
}

(async () => {
  // CI installs the playwright devDep but never downloads its browser, so a
  // bare launch() dies on "Executable doesn't exist at .../chrome-headless-shell"
  // (run 41095901556). Every other Playwright gate in the workflow pins the
  // runner's system Chrome (qa-scurve, qa-spy-nav, qa-console-stress); QA_CHANNEL
  // overrides it when a local machine only has the bundled build.
  const browser = await chromium.launch({
    channel: process.env.QA_CHANNEL || 'chrome',
    args: ['--disk-cache-size=0']
  });

  // ---------- first paint ----------
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(250);
    const early = await page.evaluate(() => {
      const stage = document.querySelector('.hg-stage');
      return {
        heroCards: document.querySelectorAll('.hero-cards, .hero-card').length,
        stageShown: !!stage && getComputedStyle(stage).display !== 'none' && stage.offsetHeight > 0,
        poster: !!document.querySelector('.hg-poster')
      };
    });
    check(
      'U-08',
      'no fallback white hero cards in the DOM',
      early.heroCards === 0,
      'found ' + early.heroCards
    );
    check(
      'U-08',
      'globe stage + poster visible at first paint (no flash of other content)',
      early.stageShown && early.poster,
      JSON.stringify(early)
    );
    await ctx.close();
  }

  // ---------- main page, desktop ----------
  const { ctx, page } = await newPage(browser);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 160)));
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(4500);

  // U-03 buttons
  const btns = await page.evaluate(() =>
    [...document.querySelectorAll('.btn')]
      .filter(b => b.offsetWidth > 0)
      .map(b => ({
        t: b.textContent.trim().slice(0, 18),
        r: getComputedStyle(b).borderTopLeftRadius,
        h: Math.round(b.getBoundingClientRect().height),
        hero: !!b.closest('.hero-cta, .pb-cta')
      }))
  );
  check(
    'U-03',
    'every .btn on the page has an 8px radius',
    btns.length > 0 && btns.every(b => b.r === '8px'),
    JSON.stringify([...new Set(btns.map(b => b.r))])
  );
  check(
    'U-03',
    'hero and band CTAs are the large size (>= 48px tall)',
    btns.filter(b => b.hero).every(b => b.h >= 48),
    JSON.stringify(btns.filter(b => b.hero).map(b => b.h))
  );
  check(
    'U-03',
    'header Get Started is 40px tall',
    btns.some(b => b.t === 'Get Started' && b.h === 40)
  );

  // U-04 pills
  const pills = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('body *').forEach(e => {
      if (e.closest('.ft-perf')) return; // a toggle switch is allowed to be a pill
      const r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.width === r.height) return;
      const st = getComputedStyle(e);
      if (st.display === 'none' || st.visibility === 'hidden') return;
      const rad = parseFloat(st.borderTopLeftRadius);
      if (!rad) return;
      const half = Math.min(r.width, r.height) / 2;
      const eff =
        st.borderTopLeftRadius.indexOf('%') > -1 ? (rad / 100) * Math.min(r.width, r.height) : rad;
      if (eff >= half - 0.5 && Math.max(r.width, r.height) > 24)
        out.push(e.className.toString().split(' ')[0] || e.tagName);
    });
    return out;
  });
  check(
    'U-04',
    'no pill-shaped elements on the landing page',
    pills.length === 0,
    pills.length + ' pills: ' + [...new Set(pills)].join(',')
  );
  const round = await page.evaluate(() =>
    [...document.querySelectorAll('.feat-btn')]
      .filter(b => b.offsetWidth)
      .map(b => getComputedStyle(b).borderTopLeftRadius)
  );
  check(
    'U-04',
    'carousel/arrow buttons (if present) are rounded squares, not circles',
    round.every(r => r === '8px'),
    JSON.stringify(round)
  );

  // U-05 gold ramp
  const ramp = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = n => cs.getPropertyValue(n).trim().toLowerCase();
    return {
      g50: v('--gold-50'),
      g100: v('--gold-100'),
      g300: v('--gold-300'),
      g500: v('--gold-500'),
      g700: v('--gold-700')
    };
  });
  check(
    'U-05',
    '--gold-500 is the bullion gold, --gold-700 is the bronze text step',
    ramp.g500 === '#d4af37' && ramp.g700 === '#7a5a0b',
    JSON.stringify(ramp)
  );
  const amber = ['#f59e0b', '#b45309', '#fcd34d', '#fef3c7', '#fffbeb'];
  check(
    'U-05',
    'no amber (Tailwind) hex left in the gold ramp',
    !Object.values(ramp).some(x => amber.includes(x)),
    JSON.stringify(ramp)
  );

  // U-10 pause
  check('U-10', 'no on-globe Pause/Play pill', (await page.locator('.hg-play').count()) === 0);

  // U-09 globe keeps turning under hover and the hover area is the globe, not the column
  const lon = () =>
    page.evaluate(() =>
      window.MMGR_GLOBE && window.MMGR_GLOBE.state ? window.MMGR_GLOBE.state.lon : null
    );
  const frame = await page.locator('.hg-frame').boundingBox();
  if (frame) {
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
    await page.waitForTimeout(400);
    const a = await lon();
    await page.waitForTimeout(2500);
    const b = await lon();
    let d = Math.abs(((b - a + 540) % 360) - 180);
    d = 180 - d; // wrapped difference
    d = Math.abs(((((b - a) % 360) + 540) % 360) - 180); // not used further, kept simple below
    const delta = Math.abs(b - a);
    check(
      'U-09',
      'globe keeps rotating while the pointer is on it (>= 4 degrees in 2.5 s)',
      delta >= 4,
      'moved ' + delta.toFixed(2) + ' deg'
    );
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height + 80);
    await page.waitForTimeout(300);
    const inter = await page.evaluate(() => window.MMGR_GLOBE.state.interacting);
    check(
      'U-09',
      'hover area is the visible globe only (80px below it is not "interacting")',
      inter === false,
      'interacting=' + inter
    );
    await page.mouse.move(5, 5);
  } else {
    check('U-09', 'globe frame exists', false);
  }
  const sc = await page.evaluate(() => {
    const c = document.querySelector('.hg-card');
    return c ? getComputedStyle(c).backgroundColor : null;
  });
  const lumOf = css => {
    const m = css && css.match(/\d+/g);
    return m ? (0.2126 * +m[0] + 0.7152 * +m[1] + 0.0722 * +m[2]) / 255 : 1;
  };
  check(
    'U-09',
    'globe pop-out cards are dark solid cards (not white)',
    lumOf(sc) < 0.2,
    String(sc)
  );

  // U-14 dot rail
  const dots = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.dot-item:not(.active)')];
    const rail = document.querySelector('.dot-rail-navigation');
    return {
      ops: [...new Set(items.map(d => +getComputedStyle(d).opacity))],
      tone: rail ? rail.getAttribute('data-tone') : null
    };
  });
  check(
    'U-14',
    'resting dots are 0.5 to 0.75 opaque (visible, still quiet)',
    dots.ops.length > 0 && dots.ops.every(o => o >= 0.5 && o <= 0.75),
    JSON.stringify(dots.ops)
  );
  check(
    'U-14',
    'rail carries data-tone (light/dark) so dot colour follows the section behind it',
    dots.tone === 'light' || dots.tone === 'dark',
    String(dots.tone)
  );

  // U-07 dropdown
  await page.locator('.site-nav a.nav-link', { hasText: 'Features' }).first().hover();
  await page.waitForTimeout(700);
  const dd = await page.evaluate(() => {
    const m = document.querySelector('.nav-dd.is-open .nav-dd-menu');
    if (!m) return null;
    const list = m.querySelector('.nav-dd-list');
    const r = m.getBoundingClientRect();
    const trig = document.querySelector('.nav-dd.is-open > a.nav-link').getBoundingClientRect();
    return {
      h: Math.round(r.height),
      w: Math.round(r.width),
      listDisplay: list ? getComputedStyle(list).display : null,
      descs: m.querySelectorAll('.nav-dd-desc').length,
      heads: m.querySelectorAll('.nav-dd-head').length,
      icons: m.querySelectorAll('.nav-dd-ico').length,
      rows: m.querySelectorAll('.nav-dd-item').length,
      underTrigger: r.left <= trig.left + trig.width / 2 && r.right >= trig.left + trig.width / 2
    };
  });
  check('U-07', 'Features menu opens', !!dd);
  if (dd) {
    check(
      'U-07',
      'menu is no taller than 460px (columns really render)',
      dd.h <= 460,
      'h=' + dd.h + ' list display=' + dd.listDisplay
    );
    check(
      'U-07',
      'every row has a one-line description (>= 15)',
      dd.descs >= 15,
      'descriptions=' + dd.descs
    );
    check('U-07', 'group headings present (>= 3)', dd.heads >= 3, 'headings=' + dd.heads);
    check('U-07', 'every row has an icon tile', dd.icons >= 15, 'icons=' + dd.icons);
    check('U-07', 'all 15 feature rows still present', dd.rows >= 15, 'rows=' + dd.rows);
    check('U-07', 'panel sits under its trigger', dd.underTrigger);
  }
  await page.mouse.move(5, 500);
  await page.waitForTimeout(400);

  // U-06 header states
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const top = await page.evaluate(() => {
    const h = document.querySelector('.site-header');
    const s = getComputedStyle(h),
      a = getComputedStyle(h, '::after');
    const alpha = c => {
      const m = c.match(/[\d.]+/g);
      return m && m.length > 3 ? +m[3] : 1;
    };
    return {
      scrolled: h.getAttribute('data-scrolled'),
      bgAlpha: alpha(s.backgroundColor),
      blur: s.backdropFilter,
      afterBlur: a.backdropFilter,
      afterOpacity: +a.opacity
    };
  });
  await page.evaluate(() => window.scrollTo(0, 1400));
  await page.waitForTimeout(700);
  const low = await page.evaluate(() => {
    const h = document.querySelector('.site-header');
    const s = getComputedStyle(h),
      a = getComputedStyle(h, '::after');
    return {
      scrolled: h.getAttribute('data-scrolled'),
      blur: s.backdropFilter,
      afterBlur: a.backdropFilter,
      afterOpacity: +a.opacity
    };
  });
  check(
    'U-06',
    'at the top the header is solid white (alpha 1, no blur)',
    top.scrolled === 'false' &&
      top.bgAlpha === 1 &&
      (top.blur === 'none' || top.blur === '') &&
      (top.afterOpacity === 0 || top.afterBlur === 'none'),
    JSON.stringify(top)
  );
  const blurOn = x =>
    (x.blur && x.blur !== 'none') ||
    (x.afterBlur && x.afterBlur !== 'none' && x.afterOpacity > 0.9);
  check(
    'U-06',
    'scrolled into the page the header turns translucent and blurred',
    low.scrolled === 'true' && blurOn(low),
    JSON.stringify(low)
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
  const back = await page.evaluate(() =>
    document.querySelector('.site-header').getAttribute('data-scrolled')
  );
  check('U-06', 'back at the top it returns to solid white', back === 'false', String(back));

  // U-11 / U-12 / U-13 sections
  await page.evaluate(() => document.getElementById('features').scrollIntoView());
  await page.waitForTimeout(900);
  const feat = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map(e => e.id);
    const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    const art = document.querySelector('#f-wbs .fc-art');
    const ic = document.querySelector('#f-wbs .fc-icon');
    const voice = document.querySelector('#f-voice .fc-icon use');
    return {
      tags: document.querySelectorAll('.fc-tag').length,
      dup,
      artW: art ? art.offsetWidth : 0,
      iconBg: ic ? getComputedStyle(ic).backgroundImage : '',
      voiceIcon: voice ? voice.getAttribute('href') : '',
      cards: document.querySelectorAll('#features .fcard').length
    };
  });
  check('U-11', 'no category chips on the feature cards', feat.tags === 0, 'chips=' + feat.tags);
  check('U-11', 'watermark art is large (>= 120px)', feat.artW >= 120, 'width=' + feat.artW);
  check(
    'U-11',
    'icon tile is a gold gradient',
    /gradient/.test(feat.iconBg),
    feat.iconBg.slice(0, 40)
  );
  check(
    'U-11',
    'Voice card uses a microphone icon, not a camera',
    /i-mic/.test(feat.voiceIcon),
    feat.voiceIcon
  );
  check(
    'U-12',
    'no duplicate ids (slider clones removed)',
    feat.dup.length === 0,
    JSON.stringify(feat.dup)
  );
  check(
    'U-12',
    'exactly the 15 real cards exist (no clones)',
    feat.cards === 15,
    'cards=' + feat.cards
  );
  const slide = await page.evaluate(
    () =>
      new Promise(res => {
        const f = document.querySelector('.features');
        const a = f.scrollLeft;
        setTimeout(() => res(Math.abs(f.scrollLeft - a)), 4200);
      })
  );
  check(
    'U-12',
    'the feature area does not move by itself (no auto-slide in 4.2 s)',
    slide === 0,
    'moved ' + slide + 'px'
  );

  const band = await page.evaluate(() => ({
    brand: document.querySelectorAll('.pb-brand').length,
    phases: document.querySelectorAll('.phase-rail > li').length
  }));
  check('U-13', 'no "My MaNaGeR" pill on the photo bands', band.brand === 0, 'pills=' + band.brand);
  check('U-13', 'phase rail lists 5 phases', band.phases === 5, 'phases=' + band.phases);

  // U-02 icons / manifest
  const man = await (await page.request.get(BASE + '/manifest.webmanifest')).json();
  const has = (size, purpose) =>
    (man.icons || []).some(i => i.sizes === size && i.purpose === purpose && /\.png$/.test(i.src));
  check(
    'U-02',
    'manifest has 192 + 512 "any" and 192 + 512 "maskable" PNG icons',
    has('192x192', 'any') &&
      has('512x512', 'any') &&
      has('192x192', 'maskable') &&
      has('512x512', 'maskable'),
    JSON.stringify((man.icons || []).map(i => i.sizes + ':' + i.purpose))
  );
  const sizesOk = [];
  for (const i of man.icons || []) {
    const dim = await page.evaluate(
      u =>
        new Promise(r => {
          const im = new Image();
          im.onload = () => r(im.naturalWidth + 'x' + im.naturalHeight);
          im.onerror = () => r('missing');
          im.src = u;
        }),
      BASE + '/' + i.src
    );
    sizesOk.push(dim === i.sizes);
  }
  check(
    'U-02',
    'every manifest icon is the size it declares (and square)',
    sizesOk.length > 0 && sizesOk.every(Boolean),
    JSON.stringify(sizesOk)
  );
  const links = await page.evaluate(() => ({
    apple: (document.querySelector('link[rel="apple-touch-icon"]') || {}).href || '',
    svg: !!document.querySelector('link[rel="icon"][type="image/svg+xml"]'),
    og: (document.querySelector('meta[property="og:image"]') || {}).content || ''
  }));
  const apple = await page.evaluate(
    u =>
      new Promise(r => {
        if (!u) return r(null);
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => {
          const c = document.createElement('canvas');
          c.width = im.naturalWidth;
          c.height = im.naturalHeight;
          const x = c.getContext('2d');
          x.drawImage(im, 0, 0);
          r({
            w: im.naturalWidth,
            a: [
              x.getImageData(0, 0, 1, 1).data[3],
              x.getImageData(c.width - 1, c.height - 1, 1, 1).data[3]
            ]
          });
        };
        im.onerror = () => r(null);
        im.src = u;
      }),
    links.apple ? BASE + new URL(links.apple, BASE).pathname : ''
  );
  check(
    'U-02',
    'apple-touch-icon is 180px and fully opaque (iOS fills transparency with black)',
    !!apple && apple.w === 180 && apple.a[0] === 255 && apple.a[1] === 255,
    JSON.stringify(apple)
  );
  check('U-02', 'SVG favicon link present', links.svg);
  const ico = await page.request.get(BASE + '/favicon.ico');
  check(
    'U-02',
    '/favicon.ico exists (browsers request it by default)',
    ico.status() === 200,
    'status ' + ico.status()
  );
  check(
    'U-02',
    'og:image is a raster image (png/jpg/webp), not SVG',
    /\.(png|jpe?g|webp)(\?|$)/i.test(links.og),
    links.og
  );

  check('U-00', 'no uncaught page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();

  // ---------- reduced motion ----------
  {
    const { ctx: c2, page: p2 } = await newPage(browser, { reducedMotion: 'reduce' });
    await p2.goto(BASE + '/index.html', { waitUntil: 'load' });
    await p2.waitForTimeout(2500);
    await p2.locator('.site-nav a.nav-link', { hasText: 'Features' }).first().hover();
    await p2.waitForTimeout(500);
    const rm = await p2.evaluate(() => {
      const m = document.querySelector('.nav-dd.is-open .nav-dd-menu');
      const h = document.querySelector('.site-header');
      const lon0 =
        window.MMGR_GLOBE && window.MMGR_GLOBE.state ? window.MMGR_GLOBE.state.lon : null;
      const dur = e =>
        e
          ? Math.max(
              ...getComputedStyle(e)
                .transitionDuration.split(',')
                .map(s => parseFloat(s) * (s.includes('ms') ? 0.001 : 1))
            )
          : null;
      return {
        menuT: dur(m),
        menuTransform: m ? getComputedStyle(m).transform : null,
        headerT: dur(h),
        lon0
      };
    });
    await p2.waitForTimeout(1500);
    const lon1 = await p2.evaluate(() =>
      window.MMGR_GLOBE && window.MMGR_GLOBE.state ? window.MMGR_GLOBE.state.lon : null
    );
    check(
      'U-07',
      'reduced motion: dropdown uses an opacity-only fade (no transform)',
      rm.menuTransform === 'none' || rm.menuTransform === 'matrix(1, 0, 0, 1, 0, 0)',
      JSON.stringify(rm)
    );
    check(
      'U-09',
      'reduced motion: the globe stays still',
      rm.lon0 === null || Math.abs(lon1 - rm.lon0) < 0.01,
      rm.lon0 + ' -> ' + lon1
    );
    await c2.close();
  }

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(
    '\n' +
      (results.length - failed.length) +
      '/' +
      results.length +
      ' passed' +
      (failed.length ? '   FAILED: ' + [...new Set(failed.map(f => f.id))].join(', ') : '')
  );
  process.exit(failed.length ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(2);
});
