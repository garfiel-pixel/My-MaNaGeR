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
