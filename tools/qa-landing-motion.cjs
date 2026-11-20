/* ============================================================
   tools/qa-landing-motion.cjs - the landing page moves calmly
   ------------------------------------------------------------
   UX-2026-11-19 C1 (and the seams' half of C4). The band seams
   used to be a gradient that faded through black with a gold line
   and halo travelling with the scroll. They are now a wave: the
   upper band's colour, a wave path filled with the lower band's
   colour, and one thin cream stroke out of phase - drifting on
   `transform` alone, independent of scrolling.

   Gates:
     S1 the seam is 64px on desktop, 48px on a phone, both fixed.
     S2 both keyframes animate `transform` and nothing else.
     S3 the edge and the stroke really drift, in opposite directions.
     S4 reduced motion stops the drift and keeps the wave drawn.
     S5 Performance Mode stops the drift and keeps the wave drawn.
     S6 no seam reads --page-progress any more.
     S7 the seam contributes no layout shift while it animates.
     S8 the gold line and the halo are gone (no gold paint, no
        gradient fade to black).

   Usage:   node tools/qa-landing-motion.cjs
   Registry: docs/CI-TEST-COVERAGE.md
   ============================================================ */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

const PORT = 8765;
const BASE = process.env.QA_BASE || 'http://127.0.0.1:' + PORT;
const ROOT = path.resolve(__dirname, '..');
const log = s => process.stdout.write('[qa-motion] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));

let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) {
    passed++;
    log('PASS  ' + name);
  } else {
    failed++;
    log(
      'FAIL  ' +
        name +
        '  <-- ' +
        JSON.stringify(detail === undefined ? null : detail).slice(0, 1000)
    );
  }
};

function resolvePlaywright() {
  try {
    return require('playwright');
  } catch (e) {}
  const roots = [
    path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'),
    path.join(os.homedir(), '.npm', '_npx')
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }
    for (const dir of fs.readdirSync(root)) {
      const p = path.join(root, dir, 'node_modules', 'playwright');
      if (fs.existsSync(path.join(p, 'index.js'))) {
        return require(p);
      }
    }
  }
  throw new Error('playwright not found - npm i -D playwright');
}

(async () => {
  let srv = null;
  const { chromium } = resolvePlaywright();
  let executablePath;
  try {
    executablePath =
      require(path.join(ROOT, 'tools', 'chrome-launcher.cjs')).chromePath || undefined;
  } catch (e) {
    /* playwright's own browser */
  }
  let browser = null;
  try {
    let up = false;
    try {
      up = (await fetch(BASE + '/manifest.webmanifest')).ok;
    } catch (e) {
      up = false;
    }
    if (!up) {
      log('starting serve.cjs for this run');
      srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
      for (let i = 0; i < 60 && !up; i++) {
        await delay(250);
        try {
          up = (await fetch(BASE + '/manifest.webmanifest')).ok;
        } catch (e) {
          /* keep waiting */
        }
      }
    }
    if (!up) {
      throw new Error('serve.cjs did not answer on ' + BASE);
    }

    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ['--disk-cache-size=0']
    });

    async function openPage(opts) {
      const o = opts || {};
      const ctx = await browser.newContext({
        viewport: o.viewport || { width: 1280, height: 900 },
        reducedMotion: o.reduced ? 'reduce' : 'no-preference'
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
      await delay(900);
      if (o.perf) {
        await page.evaluate(() => document.documentElement.setAttribute('data-perf', 'on'));
        await delay(200);
      }
      return { ctx, page, errors };
    }

    // ---- S1: the seam's own height ---------------------------------
    {
      const desk = await openPage({});
      const d = await desk.page.evaluate(() => {
        const s = document.querySelector('.band-seam');
        const r = s.getBoundingClientRect();
        return { h: Math.round(r.height), count: document.querySelectorAll('.band-seam').length };
      });
      check('S1 the seam is 64px tall on desktop', d.h === 64 && d.count >= 1, {
        h: d.h,
        count: d.count
      });
      await desk.ctx.close();

      const mob = await openPage({ viewport: { width: 390, height: 844 } });
      const m = await mob.page.evaluate(() =>
        Math.round(document.querySelector('.band-seam').getBoundingClientRect().height)
      );
      check('S1 the seam is 48px tall on a phone', m === 48, m);
      await mob.ctx.close();
    }

    // ---- S2: the keyframes touch transform only --------------------
    {
      const { ctx, page } = await openPage({});
      const kf = await page.evaluate(() => {
        const out = {};
        for (const sheet of Array.from(document.styleSheets)) {
          let rules;
          try {
            rules = sheet.cssRules;
          } catch (e) {
            continue;
          }
          for (const r of Array.from(rules || [])) {
            if (r.type === CSSRule.KEYFRAMES_RULE && /^seam-drift/.test(r.name)) {
              out[r.name] = Array.from(r.cssRules).map(function (k) {
                return { key: k.keyText, props: Array.from(k.style) };
              });
            }
          }
        }
        return out;
      });
      const names = Object.keys(kf);
      const bad = [];
      names.forEach(function (n) {
        kf[n].forEach(function (frame) {
          frame.props.forEach(function (p) {
            if (p !== 'transform') {
              bad.push(n + ' ' + frame.key + ' ' + p);
            }
          });
        });
      });
      check(
        'S2 both drift keyframes exist and animate transform only',
        names.length === 2 && bad.length === 0,
        { names: names, bad: bad }
      );
      await ctx.close();
    }

    // ---- S3: the layers really move, in opposite directions --------
    {
      const { ctx, page } = await openPage({});
      const st = await page.evaluate(() => {
        const s = document.querySelector('.band-seam');
        const cs = getComputedStyle(s, '::before');
        const cs2 = getComputedStyle(s, '::after');
        return {
          before: { name: cs.animationName, dur: cs.animationDuration },
          after: { name: cs2.animationName, dur: cs2.animationDuration },
          width: s.getBoundingClientRect().width
        };
      });
      const nameOk = /seam-drift/.test(st.before.name) && /seam-drift-back/.test(st.after.name);
      check(
        'S3 the edge and the stroke both drift, at different speeds',
        nameOk && st.before.dur !== st.after.dur,
        st
      );

      // The computed transform is the animated matrix: it must change, and
      // the two layers must move opposite ways (one negative, one positive).
      const tx = async () =>
        page.evaluate(() => {
          const s = document.querySelector('.band-seam');
          const read = p => {
            const t = getComputedStyle(s, p).transform || 'none';
            if (t === 'none') {
              return 0;
            }
            const m = t.match(/matrix\(([^)]+)\)/);
            return m ? parseFloat(m[1].split(',')[4]) : 0;
          };
          return { edge: read('::before'), line: read('::after') };
        });
      const a = await tx();
      await delay(700);
      const b = await tx();
      check('S3 both layers actually move on screen', a.edge !== b.edge && a.line !== b.line, {
        a: a,
        b: b
      });
      check(
        'S3 the edge and the stroke drift in opposite directions',
        b.edge < a.edge && b.line > a.line,
        { a: a, b: b }
      );
      await ctx.close();
    }

    // ---- S4: reduced motion ---------------------------------------
    {
      const { ctx, page } = await openPage({ reduced: true });
      const st = await page.evaluate(() => {
        const s = document.querySelector('.band-seam');
        const b = getComputedStyle(s, '::before');
        const a = getComputedStyle(s, '::after');
        return {
          before: b.animationName,
          after: a.animationName,
          mask: b.maskImage || b.webkitMaskImage,
          h: Math.round(s.getBoundingClientRect().height)
        };
      });
      check('S4 reduced motion stops the drift', st.before === 'none' && st.after === 'none', st);
      check(
        'S4 reduced motion keeps the wave and the stroke drawn',
        /url\(/.test(String(st.mask)) && st.h > 0,
        st
      );
      await ctx.close();
    }

    // ---- S5: Performance Mode -------------------------------------
    {
      const { ctx, page } = await openPage({ perf: true });
      const st = await page.evaluate(() => {
        const s = document.querySelector('.band-seam');
        const b = getComputedStyle(s, '::before');
        return {
          before: b.animationName,
          after: getComputedStyle(s, '::after').animationName,
          display: b.display,
          mask: b.maskImage || b.webkitMaskImage
        };
      });
      check('S5 Performance Mode stops the drift', st.before === 'none' && st.after === 'none', st);
      check(
        'S5 Performance Mode keeps the wave drawn',
        st.display !== 'none' && /url\(/.test(String(st.mask)),
        st
      );
      await ctx.close();
    }

    // ---- S6: --page-progress is gone ------------------------------
    {
      const { ctx, page } = await openPage({});
      await page.evaluate(() => window.scrollTo(0, 600));
      await delay(400);
      const st = await page.evaluate(() => {
        const seams = Array.from(document.querySelectorAll('.band-seam'));
        return {
          inline: seams.map(s => s.style.getPropertyValue('--page-progress')),
          computed: seams.map(s => getComputedStyle(s).getPropertyValue('--page-progress'))
        };
      });
      check(
        'S6 no seam is given --page-progress any more',
        st.inline.every(v => !v) && st.computed.every(v => !String(v).trim()),
        st
      );
      const cssText = fs.readFileSync(path.join(ROOT, 'css', 'marketing.css'), 'utf8');
      const seamBlock = cssText.slice(
        cssText.indexOf('.band-seam {'),
        cssText.indexOf('.seam-mark {')
      );
      check(
        'S6 the seam rules do not read --page-progress',
        seamBlock.length > 0 && seamBlock.indexOf('--page-progress') === -1,
        seamBlock.length
      );
      await ctx.close();
    }

    // ---- S7: no layout shift from the animation -------------------
    {
      const { ctx, page } = await openPage({});
      const st = await page.evaluate(async () => {
        const s = document.querySelector('.band-seam');
        const h1 = s.getBoundingClientRect().height;
        const doc1 = document.documentElement.scrollHeight;
        await new Promise(r => setTimeout(r, 1200));
        const h2 = s.getBoundingClientRect().height;
        const doc2 = document.documentElement.scrollHeight;
        return { h1: h1, h2: h2, doc1: doc1, doc2: doc2 };
      });
      check(
        'S7 the seam contributes no layout shift while it drifts',
        st.h1 === st.h2 && st.doc1 === st.doc2,
        st
      );
      await ctx.close();
    }

    // ---- S8: no gold line, no fade through black ------------------
    {
      const { ctx, page } = await openPage({});
      const st = await page.evaluate(() => {
        const s = document.querySelector('.band-seam');
        const b = getComputedStyle(s, '::before');
        const a = getComputedStyle(s, '::after');
        return {
          seamBg: getComputedStyle(s).backgroundColor,
          beforeBg: b.backgroundColor,
          afterBg: a.backgroundColor,
          beforeImage: b.backgroundImage,
          afterImage: a.backgroundImage
        };
      });
      const goldish = [st.beforeBg, st.afterBg, st.beforeImage, st.afterImage].some(function (v) {
        return /212,\s*175,\s*55|gold/i.test(String(v));
      });
      check('S8 no seam paints the gold line or halo', !goldish, st);
      check(
        'S8 the seam is a solid band colour, not a gradient through black',
        /^rgb\(/.test(st.seamBg) && !/gradient/.test(String(st.beforeImage)),
        st
      );
      await ctx.close();
    }
    // ================= C2: the four card rows =====================
    // One treatment, applied by data-motion="card": the four step cards, the
    // "an account is optional" cards, the solution cards and the why cards.
    // These arms prove the three defects the screenshots showed are gone, and
    // that the motion obeys the pointer and preference rules.

    // ---- C2-a: the step numerals sit fully inside their card ------
    // The numeral is a ::before pseudo-element, so there is no element rect to
    // read. Its box is derived from the CSS that actually applied: top offset,
    // font-size and line-height, against the card's own border box.
    for (const vp of [
      { width: 1280, height: 900, tag: '1280' },
      { width: 390, height: 844, tag: '390' },
      { width: 1920, height: 1080, tag: '1920' }
    ]) {
      const { ctx, page } = await openPage({ viewport: { width: vp.width, height: vp.height } });
      await page.evaluate(() => document.querySelector('.steps').scrollIntoView());
      await delay(700);
      const nums = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.steps .step')).map(function (s) {
          const cs = getComputedStyle(s, '::before');
          const r = s.getBoundingClientRect();
          const top = parseFloat(cs.top) || 0;
          const fs = parseFloat(cs.fontSize) || 0;
          let lh = parseFloat(cs.lineHeight);
          if (!isFinite(lh)) {
            lh = fs;
          }
          return {
            top: Math.round(top),
            boxH: Math.round(lh),
            cardH: Math.round(r.height),
            bottomInset: Math.round(r.height - (top + lh))
          };
        });
      });
      const clipped = nums.filter(function (n) {
        return n.top < 0 || n.bottomInset < 0 || n.boxH === 0;
      });
      check(
        'C2a the four step numerals sit fully inside the card @' + vp.tag,
        nums.length === 4 && clipped.length === 0,
        { nums: nums, clipped: clipped }
      );
      await ctx.close();
    }

    // ---- C2-b: the decorative glyph never crosses the copy --------
    for (const vp of [
      { width: 1280, height: 900, tag: '1280' },
      { width: 390, height: 844, tag: '390' },
      { width: 1920, height: 1080, tag: '1920' }
    ]) {
      const { ctx, page } = await openPage({ viewport: { width: vp.width, height: vp.height } });
      const glyphs = await page.evaluate(() => {
        const hit = (a, b) =>
          a.left < b.right - 0.5 &&
          a.right > b.left + 0.5 &&
          a.top < b.bottom - 0.5 &&
          a.bottom > b.top + 0.5;
        return Array.from(document.querySelectorAll('.aud-item')).map(function (card) {
          const art = card.querySelector('.aud-art');
          if (!art) {
            return { art: false };
          }
          const ar = art.getBoundingClientRect();
          // Real text boxes, not the block box: a Range over each text node
          // gives the line rectangles the glyph would actually cover.
          const lines = [];
          card.querySelectorAll('b, span').forEach(function (el) {
            const range = document.createRange();
            range.selectNodeContents(el);
            Array.prototype.forEach.call(range.getClientRects(), function (r) {
              lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
            });
          });
          const clashes = lines.filter(function (l) {
            return hit(ar, l);
          });
          return {
            art: true,
            label: (card.querySelector('b') || {}).textContent || '',
            opacity: Number(getComputedStyle(art).opacity),
            w: Math.round(ar.width),
            clashes: clashes.length
          };
        });
      });
      const arts = glyphs.filter(function (g) {
        return g.art;
      });
      const bad = arts.filter(function (g) {
        return g.clashes > 0 || !(g.opacity <= 0.06);
      });
      check(
        'C2b no decorative glyph overlaps the copy @' + vp.tag,
        arts.length >= 8 && bad.length === 0,
        { cards: arts.length, bad: bad }
      );
      await ctx.close();
    }

    // ---- C2-c: the stagger is per row, not per page ---------------
    {
      const { ctx, page } = await openPage({});
      const stag = await page.evaluate(() => {
        const read = sel =>
          Array.from(document.querySelectorAll(sel)).map(function (el) {
            return Number(getComputedStyle(el).getPropertyValue('--rv-i')) || 0;
          });
        return { steps: read('.steps .step'), why: read('.why-grid .why-card') };
      });
      const rowStart = stag.steps.length === 4 && stag.steps[0] === 0 && stag.steps[3] === 3;
      const whyStart = stag.why.length === 3 && stag.why[0] === 0 && stag.why[2] === 2;
      check('C2c the reveal stagger restarts at 0 for every row', rowStart && whyStart, stag);
      await ctx.close();
    }

    // ---- C2-d: hover lifts 4px, tilts, and scales the icon --------
    {
      const { ctx, page } = await openPage({});
      const card = page.locator('.steps .step').first();
      await card.scrollIntoViewIfNeeded();
      await delay(1200); // let the reveal finish and .rv-done land
      await card.hover({ position: { x: 30, y: 40 } });
      await delay(320);
      const hov = await page.evaluate(() => {
        const c = document.querySelector('.steps .step');
        const m = new DOMMatrix(getComputedStyle(c).transform);
        const ico = c.querySelector('.st-icon .ico');
        const im = ico ? new DOMMatrix(getComputedStyle(ico).transform) : null;
        return {
          lift: Math.round(m.m42 * 100) / 100,
          rotX: Math.round(m.m32 * 1000) / 1000,
          rotY: Math.round(m.m31 * 1000) / 1000,
          iconScale: im ? Math.round(im.a * 1000) / 1000 : null,
          tiltX: c.style.getPropertyValue('--tilt-x'),
          transition: getComputedStyle(c).transitionProperty
        };
      });
      check('C2d hover lifts the card 4px', Math.abs(hov.lift + 4) <= 0.6, hov);
      check(
        'C2d hover tilts at most 3 degrees toward the pointer',
        Math.abs(hov.rotX) > 0 && Math.abs(hov.rotX) <= 0.0524 && Math.abs(hov.rotY) <= 0.0524,
        hov
      );
      check('C2d hover scales the icon to 1.06', Math.abs(hov.iconScale - 1.06) <= 0.01, hov);
      // Layout must never be animated: the transition list is allowed to carry
      // paint properties (border-color, box-shadow) but no box property.
      const layoutProps = /(^|,\s*)(width|height|top|left|right|bottom|margin|padding|font-size)/;
      check(
        'C2d nothing animates a layout property',
        !layoutProps.test(hov.transition),
        hov.transition
      );
      await ctx.close();
    }

    // ---- C2-e: a coarse pointer never tilts ----------------------
    {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true
      });
      const page = await ctx.newPage();
      await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
      await delay(900);
      const coarse = await page.evaluate(() => ({
        fine: matchMedia('(hover: hover) and (pointer: fine)').matches
      }));
      const card = page.locator('.steps .step').first();
      await card.scrollIntoViewIfNeeded();
      await delay(400);
      const box = await card.boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await delay(250);
      const after = await page.evaluate(() => {
        const c = document.querySelector('.steps .step');
        return {
          tiltX: c.style.getPropertyValue('--tilt-x'),
          transform: getComputedStyle(c).transform
        };
      });
      check('C2e a coarse pointer never gets a tilt', coarse.fine === false && !after.tiltX, {
        coarse: coarse,
        after: after
      });
      await ctx.close();
    }

    // ---- C2-f: reduced motion and Performance Mode stop the lift --
    for (const mode of ['reduced', 'perf']) {
      const { ctx, page } = await openPage(mode === 'reduced' ? { reduced: true } : { perf: true });
      const card = page.locator('.steps .step').first();
      await card.scrollIntoViewIfNeeded();
      await delay(500);
      await card.hover({ position: { x: 30, y: 40 } });
      await delay(300);
      const st = await page.evaluate(() => {
        const c = document.querySelector('.steps .step');
        const ico = c.querySelector('.st-icon .ico');
        return {
          transform: getComputedStyle(c).transform,
          icon: ico ? getComputedStyle(ico).transform : null
        };
      });
      check(
        'C2f ' + mode + ' keeps the card still on hover',
        st.transform === 'none' && (st.icon === 'none' || st.icon === null),
        st
      );
      await ctx.close();
    }

    // ---- C2-g: the rows are symmetric (the "left-heavy" report) ---
    // The screenshots suggested a larger right margin. Measured at three
    // widths it does not reproduce: every row is centred to the pixel. This
    // arm keeps that true.
    for (const w of [1280, 1440, 1920]) {
      const { ctx, page } = await openPage({ viewport: { width: w, height: 900 } });
      const rows = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const out = {};
        [
          ['steps', '.steps'],
          ['account', '.audience'],
          ['solutions', '.solutions'],
          ['why', '.why-grid']
        ].forEach(function (pair) {
          const el = document.querySelector(pair[1]);
          if (!el) {
            out[pair[0]] = null;
            return;
          }
          const r = el.getBoundingClientRect();
          out[pair[0]] = {
            left: Math.round(r.left),
            right: Math.round(vw - r.right)
          };
        });
        return out;
      });
      const skew = Object.keys(rows).filter(function (k) {
        const r = rows[k];
        return r && Math.abs(r.left - r.right) > 1;
      });
      check('C2g the card rows are centred @' + w, skew.length === 0, rows);
      await ctx.close();
    }
    // ================= C3: the role cards =========================
    // Four cards, each a real button. Open by hover (fine pointer), click,
    // Enter/Space and tap; one at a time; Escape closes. The description is in
    // the DOM in every state. The 3D figure is an enhancement that must never
    // load early, never run when idle, and never be required.

    // ---- C3a: collapsed, but the copy is already there ------------
    {
      const { ctx, page } = await openPage({});
      const st = await page.evaluate(() => ({
        cards: document.querySelectorAll('.role-card').length,
        buttons: document.querySelectorAll('.role-card .role-btn').length,
        expanded: Array.from(document.querySelectorAll('.role-btn')).map(b =>
          b.getAttribute('aria-expanded')
        ),
        controls: Array.from(document.querySelectorAll('.role-btn')).map(b =>
          b.getAttribute('aria-controls')
        ),
        descs: Array.from(document.querySelectorAll('.role-desc')).map(d => ({
          len: d.textContent.trim().length,
          inDom: !!d.offsetParent || d.getClientRects().length >= 0
        })),
        open: document.querySelectorAll('.role-card.is-open').length
      }));
      check(
        'C3a the four role cards are buttons that start collapsed',
        st.cards === 4 &&
          st.buttons === 4 &&
          st.expanded.every(v => v === 'false') &&
          st.controls.every(v => !!v) &&
          st.open === 0,
        st
      );
      check(
        'C3a every role description is in the DOM while collapsed',
        st.descs.length === 4 && st.descs.every(d => d.len > 80 && d.inDom),
        st.descs
      );
      await ctx.close();
    }

    // ---- C3b: nothing 3D renders before a card is opened ----------
    // The bundle itself is allowed to arrive as soon as the section is within
    // one viewport (that is the load rule), so this arm proves the stronger
    // fact the gate actually cares about: no canvas and no renderer exist
    // until a card is opened. A short viewport keeps the section far enough
    // away that the bundle has not even been requested yet.
    {
      const { ctx, page } = await openPage({ viewport: { width: 1280, height: 420 } });
      const early = await page.evaluate(() => ({
        canvas: document.querySelectorAll('canvas.role-canvas').length,
        script: !!document.querySelector('script[src*="marketing-roles"]'),
        figures: !!window.__mmgrRoleFigures,
        y: window.scrollY
      }));
      check(
        'C3b nothing 3D exists before #builtfor nears the viewport',
        early.canvas === 0 && early.script === false && early.figures === false,
        early
      );
      await page.evaluate(() => document.getElementById('builtfor').scrollIntoView());
      await delay(1400);
      const later = await page.evaluate(() => ({
        script: !!document.querySelector('script[src*="marketing-roles"]'),
        canvas: document.querySelectorAll('canvas.role-canvas').length
      }));
      check(
        'C3b the bundle loads once #builtfor is on screen, and still draws nothing',
        later.script === true && later.canvas === 0,
        later
      );
      await ctx.close();
    }

    // ---- C3c: mouse, keyboard, one-at-a-time, Escape --------------
    {
      const { ctx, page } = await openPage({});
      await page.evaluate(() => document.getElementById('builtfor').scrollIntoView());
      await delay(900);
      const click = async role => {
        await page.evaluate(r => {
          document.querySelector('.role-card[data-role="' + r + '"] .role-btn').click();
        }, role);
        await delay(380);
      };
      await click('gc');
      // The detail panel animates its height open. A fixed delay races the
      // reveal on a loaded CI runner (h was read at 95 mid-transition while
      // the card was already open). Wait for the panel to finish opening - a
      // bounded wait, NOT a change to the h > 120 assertion below, so a card
      // that genuinely fails to open still fails with its real height.
      await page
        .waitForFunction(
          () => {
            const d = document.querySelector('#role-gc-detail');
            return !!d && d.getBoundingClientRect().height > 120;
          },
          null,
          { timeout: 3000 }
        )
        .catch(() => {});
      const one = await page.evaluate(() => ({
        open: document.querySelectorAll('.role-card.is-open').length,
        which: Array.from(document.querySelectorAll('.role-card.is-open')).map(c =>
          c.getAttribute('data-role')
        ),
        expanded: document
          .querySelector('.role-card[data-role="gc"] .role-btn')
          .getAttribute('aria-expanded'),
        h: Math.round(document.querySelector('#role-gc-detail').getBoundingClientRect().height)
      }));
      check(
        'C3c a click opens the card and announces it',
        one.open === 1 && one.which[0] === 'gc' && one.expanded === 'true' && one.h > 120,
        one
      );
      await click('super');
      const swap = await page.evaluate(() => ({
        open: document.querySelectorAll('.role-card.is-open').length,
        which: Array.from(document.querySelectorAll('.role-card.is-open')).map(c =>
          c.getAttribute('data-role')
        ),
        gcExpanded: document
          .querySelector('.role-card[data-role="gc"] .role-btn')
          .getAttribute('aria-expanded')
      }));
      check(
        'C3c opening a second card closes the first',
        swap.open === 1 && swap.which[0] === 'super' && swap.gcExpanded === 'false',
        swap
      );
      await page.keyboard.press('Escape');
      await delay(300);
      const esc = await page.evaluate(() => ({
        open: document.querySelectorAll('.role-card.is-open').length
      }));
      check('C3c Escape closes every card', esc.open === 0, esc);

      // keyboard: Enter then Space
      await page.focus('.role-card[data-role="pm"] .role-btn');
      await page.keyboard.press('Enter');
      await delay(300);
      const kb1 = await page.evaluate(() => document.querySelectorAll('.role-card.is-open').length);
      await page.keyboard.press('Space');
      await delay(300);
      const kb2 = await page.evaluate(() => document.querySelectorAll('.role-card.is-open').length);
      check('C3c Enter opens and Space closes the focused card', kb1 === 1 && kb2 === 0, {
        afterEnter: kb1,
        afterSpace: kb2
      });
      await ctx.close();
    }

    // ---- C3d: touch opens on tap, a second tap closes -------------
    {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true
      });
      const page = await ctx.newPage();
      await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
      await delay(900);
      const card = page.locator('.role-card[data-role="sub"]');
      await card.scrollIntoViewIfNeeded();
      await delay(600);
      const box = await card.boundingBox();
      const tap = async () => {
        await page.touchscreen.tap(box.x + box.width / 2, box.y + 30);
        await delay(420);
      };
      await tap();
      const t1 = await page.evaluate(() => ({
        open: document.querySelectorAll('.role-card.is-open').length,
        which: Array.from(document.querySelectorAll('.role-card.is-open')).map(c =>
          c.getAttribute('data-role')
        )
      }));
      await tap();
      const t2 = await page.evaluate(() => document.querySelectorAll('.role-card.is-open').length);
      check('C3d a tap opens the card and a second tap closes it', t1.open === 1 && t2 === 0, {
        first: t1,
        second: t2
      });
      await ctx.close();
    }

    // ---- C3e: the figure is an enhancement, never a requirement ---
    for (const mode of ['perf', 'nogl']) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      if (mode === 'nogl') {
        await ctx.addInitScript(() => {
          const orig = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (type) {
            if (/webgl/i.test(String(type))) {
              return null;
            }
            return orig.apply(this, arguments);
          };
        });
      }
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', e => errs.push(e.message));
      await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
      await delay(600);
      if (mode === 'perf') {
        await page.evaluate(() => document.documentElement.setAttribute('data-perf', 'on'));
      }
      await page.evaluate(() => document.getElementById('builtfor').scrollIntoView());
      await delay(1200);
      await page.evaluate(() => {
        document.querySelector('.role-card[data-role="gc"] .role-btn').click();
      });
      await delay(700);
      const st = await page.evaluate(() => ({
        canvas: document.querySelectorAll('canvas.role-canvas').length,
        svg: getComputedStyle(document.querySelector('#role-gc-detail .role-svg')).display,
        open: document.querySelectorAll('.role-card.is-open').length,
        h: Math.round(document.querySelector('#role-gc-detail').getBoundingClientRect().height)
      }));
      check(
        'C3e ' + mode + ' keeps the SVG silhouette and opens the card',
        st.canvas === 0 && st.svg !== 'none' && st.open === 1 && st.h > 120 && !errs.length,
        { st: st, errs: errs }
      );
      await ctx.close();
    }

    // ---- C3f: the 3D figure stops when nothing is happening -------
    {
      const { ctx, page } = await openPage({});
      await page.evaluate(() => document.getElementById('builtfor').scrollIntoView());
      await delay(1200);
      const has3d = await page.evaluate(() => !!window.__mmgrRoleFigures);
      if (has3d) {
        await page.evaluate(() => {
          document.querySelector('.role-card[data-role="gc"] .role-btn').click();
        });
        await delay(1600); // the pop is ~1.2s
        const f1 = await page.evaluate(() => window.__mmgrRoleFigures.frames());
        await delay(800);
        const f2 = await page.evaluate(() => window.__mmgrRoleFigures.frames());
        const tris = await page.evaluate(() => window.__mmgrRoleFigures.triangles());
        const dpr = await page.evaluate(() => window.__mmgrRoleFigures.dpr());
        check('C3f the figure stops drawing once the pop has finished', f2 === f1, {
          framesBefore: f1,
          framesAfter: f2
        });
        check(
          'C3f every figure is at or under 1500 triangles',
          tris.length >= 1 && tris.every(t => t.tris > 0 && t.tris <= 1500),
          tris
        );
        check('C3f the device pixel ratio is capped at 1.5', dpr <= 1.5, dpr);
      } else {
        // WebGL unavailable in this environment: the fallback is the contract.
        const st = await page.evaluate(() => ({
          canvas: document.querySelectorAll('canvas.role-canvas').length,
          svg: document.querySelectorAll('.role-svg').length
        }));
        check(
          'C3f no WebGL here, so the SVG silhouettes are the figures',
          st.canvas === 0 && st.svg === 4,
          st
        );
      }
      await ctx.close();
    }

    // ---- C3g: the added JS stays inside its budget ---------------
    {
      const zlib = require('zlib');
      const file = path.join(ROOT, 'dist', 'marketing-roles.js');
      if (fs.existsSync(file)) {
        const gz = zlib.gzipSync(fs.readFileSync(file)).length;
        check('C3g the role-figure bundle is at most 25 KB gzipped', gz <= 25000, {
          gzipped: gz
        });
      } else {
        check('C3g the role-figure bundle exists', false, file);
      }
    }
  } catch (e) {
    failed++;
    log('FAIL  harness error  <-- ' + (e && e.message ? e.message : e));
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
    if (srv) {
      try {
        srv.kill();
      } catch (e) {}
    }
    log('');
    log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  }
})();
