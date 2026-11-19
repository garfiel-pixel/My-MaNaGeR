/* ============================================================
   tools/qa-ai-theme.cjs - the AI accent follows the chosen theme
   ------------------------------------------------------------
   UX-2026-11-19 A8. A tester thought the AI button did not follow
   the chosen theme (low confidence). It did not: `.ai-fab`, the
   user bubble, the bot avatar and the panel header wash were a
   hard-coded amber gradient (`#f59e0b -> #d97706`), so every skin
   and every accent mode painted the same orange dot.

   This gate walks EVERY Customize skin (default + the eight skins)
   x EVERY accent mode (default, cyan, magenta) x light/dark and
   reads the COMPUTED paint of:
     - #ai-fab background gradient, its first stop and its label colour
     - a .ai-bot-avatar probe (same gradient as the FAB)
     - a .ai-user bubble probe
     - .ai-head's wash
   and compares them with the theme's own --gold / --gold-ink /
   --on-gold / --gold-rgb. No palette value is asserted: only that
   the paint IS the token.

   Usage:   node tools/qa-ai-theme.cjs
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
const log = s => process.stdout.write('[qa-ai-theme] ' + s + '\n');
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
        JSON.stringify(detail === undefined ? null : detail).slice(0, 1200)
    );
  }
};

// Both sides of every colour comparison, with the browser's spacing removed:
// computed values print as "rgb(212, 175, 55)" while the token probe prints
// "rgb(212,175,55)".
const norm = v => String(v || '').replace(/\s+/g, '');

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

const FLUSH_RAF = `new Promise(function (res) {
  requestAnimationFrame(function () { requestAnimationFrame(function () { res(1); }); });
})`;

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
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(
      `try { localStorage.setItem('mmgr_unlocked_demo-project', '1'); } catch (e) {}`
    );
    const page = await ctx.newPage();
    await page.goto(BASE + '/project.html?id=demo-project', { waitUntil: 'domcontentloaded' });
    await page.evaluate(FLUSH_RAF);
    await delay(800);

    const result = await page.evaluate(() => {
      const SKINS = [
        '',
        'vellum',
        'obsidian',
        'bento',
        'departure',
        'editorial',
        'guild',
        'pegboard',
        'permit'
      ];
      const ACCENTS = ['', 'cyan', 'magenta'];
      const fab = document.getElementById('ai-fab');
      if (!fab) {
        return { error: 'no #ai-fab on the project page' };
      }
      const head = document.querySelector('.ai-head');
      const thread = document.getElementById('ai-thread');

      // Resolve a custom property to the rgb() the browser actually paints.
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;left:-9999px;top:0';
      document.body.appendChild(probe);
      const tok = name => {
        probe.style.color = '';
        probe.style.color = 'var(' + name + ')';
        const v = getComputedStyle(probe).color;
        return v;
      };
      const firstStop = el => {
        const bi = getComputedStyle(el).backgroundImage;
        const m = bi.match(/rgba?\([^)]+\)/);
        return m ? m[0].replace(/\s+/g, '') : bi;
      };
      const allStops = el => {
        const bi = getComputedStyle(el).backgroundImage;
        return (bi.match(/rgba?\([^)]+\)/g) || []).map(s => s.replace(/\s+/g, ''));
      };
      // --gold-rgb is a bare triplet ("212, 175, 55"), not a colour: reading it
      // through `color` would be invalid and fall back to the inherited text
      // colour, which is exactly the sort of false negative this gate exists
      // to avoid. Read the declaration itself.
      const rgbTriplet = name => {
        const v = getComputedStyle(document.body).getPropertyValue(name) || '';
        return v.trim().replace(/\s+/g, '');
      };

      const rows = [];
      for (const skin of SKINS) {
        for (const accent of ACCENTS) {
          for (const dark of [false, true]) {
            if (window.MMGR_SKIN && MMGR_SKIN.applySkin) {
              MMGR_SKIN.applySkin(skin || null);
            }
            if (accent) {
              document.documentElement.setAttribute('data-theme', accent);
            } else {
              document.documentElement.removeAttribute('data-theme');
            }
            document.body.classList.toggle('dark-mode', dark);

            // Probes for the two AI surfaces that only exist once a
            // conversation starts.
            let avatar = document.querySelector('.ai-bot-avatar');
            let madeAvatar = false;
            if (!avatar && thread) {
              avatar = document.createElement('div');
              avatar.className = 'ai-bot-avatar';
              thread.appendChild(avatar);
              madeAvatar = true;
            }
            let bubble = document.querySelector('.ai-bubble.ai-user');
            let madeBubble = false;
            if (!bubble && thread) {
              bubble = document.createElement('div');
              bubble.className = 'ai-bubble ai-user';
              bubble.textContent = 'probe';
              thread.appendChild(bubble);
              madeBubble = true;
            }

            const gold = tok('--gold');
            const goldInk = tok('--gold-ink');
            const onGold = tok('--on-gold');
            const goldRgb = rgbTriplet('--gold-rgb');

            rows.push({
              theme:
                (skin || 'default') + '/' + (accent || 'default') + (dark ? '/dark' : '/light'),
              gold: gold,
              goldInk: goldInk,
              onGold: onGold,
              fabStops: allStops(fab),
              fabColor: getComputedStyle(fab).color,
              avatarStops: avatar ? allStops(avatar) : [],
              bubbleStops: bubble ? allStops(bubble) : [],
              bubbleColor: bubble ? getComputedStyle(bubble).color : '',
              headWash: head ? firstStop(head) : '',
              goldRgb: goldRgb
            });

            if (madeAvatar) {
              avatar.remove();
            }
            if (madeBubble) {
              bubble.remove();
            }
          }
        }
      }

      probe.remove();
      // Leave the page as it was found.
      if (window.MMGR_SKIN && MMGR_SKIN.applySkin) {
        MMGR_SKIN.applySkin(null);
      }
      document.documentElement.removeAttribute('data-theme');
      document.body.classList.remove('dark-mode');
      return { rows: rows };
    });

    if (result.error) {
      check('the project page carries the AI floating button', false, result.error);
    } else {
      const rows = result.rows || [];
      check('every skin x accent x mode was sampled', rows.length === 54, rows.length);

      const fabBad = rows.filter(r => !r.fabStops.length || norm(r.fabStops[0]) !== norm(r.gold));
      check(
        'the AI floating button paints the theme accent (first gradient stop = --gold)',
        fabBad.length === 0,
        fabBad.map(r => ({ theme: r.theme, want: r.gold, got: r.fabStops[0] }))
      );

      const fabInkBad = rows.filter(r => norm(r.fabStops[1]) !== norm(r.goldInk));
      check(
        'the AI floating button gradient ends on --gold-ink',
        fabInkBad.length === 0,
        fabInkBad.map(r => ({ theme: r.theme, want: r.goldInk, got: r.fabStops[1] }))
      );

      const fabLabelBad = rows.filter(r => norm(r.fabColor) !== norm(r.onGold));
      check(
        'the AI floating button label paints --on-gold',
        fabLabelBad.length === 0,
        fabLabelBad.map(r => ({ theme: r.theme, want: r.onGold, got: r.fabColor }))
      );

      const avatarBad = rows.filter(
        r => !r.avatarStops.length || norm(r.avatarStops[0]) !== norm(r.gold)
      );
      check(
        'the bot avatar paints the theme accent',
        avatarBad.length === 0,
        avatarBad.map(r => ({ theme: r.theme, want: r.gold, got: r.avatarStops[0] }))
      );

      const bubbleBad = rows.filter(
        r => !r.bubbleStops.length || norm(r.bubbleStops[0]) !== norm(r.gold)
      );
      check(
        'the user bubble paints the theme accent',
        bubbleBad.length === 0,
        bubbleBad.map(r => ({ theme: r.theme, want: r.gold, got: r.bubbleStops[0] }))
      );

      // The header wash is an 8% accent tint: its RGB must be --gold-rgb.
      const washBad = rows.filter(r => {
        const m = (r.headWash || '').match(/rgba?\(([^)]+)\)/);
        if (!m) {
          return true;
        }
        const parts = m[1].split(',');
        return parts.slice(0, 3).join(',') !== r.goldRgb;
      });
      check(
        'the AI panel header wash is tinted with the theme accent',
        washBad.length === 0,
        washBad.map(r => ({ theme: r.theme, want: r.goldRgb, got: r.headWash }))
      );

      // Distinct themes must actually produce distinct paints - otherwise the
      // whole check could pass while every theme painted the same colour.
      const unique = new Set(rows.map(r => r.fabStops[0]));
      check(
        'the sampled themes produce more than one accent colour',
        unique.size > 1,
        Array.from(unique)
      );
    }

    await ctx.close();
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
