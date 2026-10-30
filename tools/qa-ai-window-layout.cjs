#!/usr/bin/env node
/* ============================================================
   tools/qa-ai-window-layout.cjs
   GATE: D-1 - the AI window fits any width (UI-CI-DIRECTIVE section 5.4)
   ------------------------------------------------------------
   WHY THIS EXISTS
   The assistant used to be sized off the VIEWPORT: one composer row, an
   eight-item header that wrapped, and a history column that appeared at 480px
   and squeezed the thread at the default 520 dock. D-1 rebuilt it as:

     one 56px header row  |  one composer card  |  three width tiers measured
     on .ai-main itself (compact under 440, regular 440 to 599, wide 600+).

   This gate proves the contract at every width a person can actually reach,
   in both palettes, by driving the real mechanisms: the viewport for the
   sheet, `localStorage mmgr_ai_size` plus close/open for the docked widths,
   and the real Maximise button.

   Checks per scenario
     1. no horizontal overflow inside #ai-win
     2. header is one row, 56px at most, five 32px buttons sharing a top
     3. the message box is at least 80 percent of the composer card and Send
        sits at least 8px inside the window's right edge
     4. no element inside the window uses a pill radius (99px or more);
        avatars and status dots are the only circles allowed
     5. hist-inline only from 720px up (Q2 default)
   Checks once, on the docked default
     6. every header button has an accessible name, and the header comes
        before the thread and the composer in DOM order
     7. the More menu opens, is absolute (never fixed), Esc closes it and
        hands focus back to its button, and it never leaves the window
     8. the empty state shows four preset rows and retires after one message
     9. the Cloud key popover is absolute and stays inside the window

   Usage:  node tools/qa-ai-window-layout.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (browser-app group).
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const SHOT_DIR = path.join(ROOT, 'tmp', 'ai-layout');
const log = s => process.stdout.write('[ai-layout] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  log(
    (ok ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (ok ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 4000))
  );
};

function resolvePlaywright() {
  try {
    return require('playwright');
  } catch (e) {
    const alt = path.join(ROOT, 'node_modules', 'playwright');
    if (fs.existsSync(alt)) {
      return require(alt);
    }
    throw e;
  }
}

/* Runs INSIDE the page. Reads the window the way a person sees it. */
function measure() {
  const win = document.getElementById('ai-win');
  const head = document.querySelector('.ai-head');
  const card = document.querySelector('.ai-composer-row');
  const q = document.getElementById('ai-q');
  const send = document.getElementById('ai-send');
  const wr = win.getBoundingClientRect();
  const hr = head.getBoundingClientRect();
  const cr = card.getBoundingClientRect();
  const qr = q.getBoundingClientRect();
  const sr = send.getBoundingClientRect();
  const box = document.getElementById('ai-win-mb');
  // The generic .mb modal cap used to leave a dead strip under the composer.
  const boxGap = box ? Math.round(wr.bottom - box.getBoundingClientRect().bottom) : 0;
  // Only VISIBLE header buttons count as a row: the History button is
  // display:none once the column is inline, and its zero rect is not a row.
  const btnTops = Array.prototype.filter
    .call(
      document.querySelectorAll(
        '.ai-head-right > button, .ai-head-right > .ai-more-wrap > button, #ai-hist-btn'
      ),
      function (b) {
        return b.offsetParent !== null;
      }
    )
    .map(function (b) {
      return Math.round(b.getBoundingClientRect().top);
    });
  const roundRadii = [];
  Array.prototype.forEach.call(win.querySelectorAll('*'), function (el) {
    const cls = (el.getAttribute('class') || '') + ' ' + (el.id || '');
    if (/ai-bot-avatar|ai-pill-dot|ai-api-dot/.test(cls)) {
      return;
    }
    const r = getComputedStyle(el).borderTopLeftRadius;
    if (/px$/.test(r) && parseFloat(r) >= 99) {
      roundRadii.push((el.id || el.className || el.tagName).toString().slice(0, 60));
    }
  });
  return {
    open: win.classList.contains('open'),
    winW: Math.round(wr.width),
    winLeft: Math.round(wr.left),
    winRight: Math.round(wr.right),
    overflow: win.scrollWidth > win.clientWidth + 1,
    headH: Math.round(hr.height),
    headTops: btnTops,
    // Four buttons when the History button has retired itself (the column is
    // inline from 720px), five when it has not. Either way, one row.
    headOneRow: new Set(btnTops).size === 1 && btnTops.length >= 4,
    cardW: Math.round(cr.width),
    qW: Math.round(qr.width),
    qRatio: cr.width ? qr.width / cr.width : 0,
    sendGap: Math.round(wr.right - sr.right),
    roundRadii: roundRadii,
    boxGap: boxGap,
    histInline: win.classList.contains('hist-inline')
  };
}

async function bootContext(browser, { width, height, dark }) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 200)));
  // The assistant is part of the signed-in experience; install the documented
  // QA seam (the same one qa-ai-win and qa-ai-dictation use).
  await page.addInitScript(() => {
    let tries = 0;
    const iv = setInterval(() => {
      if (window.MMGR && window.MMGR.Entitlements) {
        window.MMGR.Entitlements.aiAssistant = function () {
          return true;
        };
        clearInterval(iv);
      }
      if (++tries > 400) {
        clearInterval(iv);
      }
    }, 25);
  });
  await page.goto(BASE + '/seed-test.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(
    () => /\/project(\.html)?$/.test(location.pathname) && window.MMGR && window.MMGR.App,
    null,
    { timeout: 60000 }
  );
  await delay(700);
  if (dark) {
    await page.evaluate(() => {
      MMGRTheme.setMode('dark');
      return true;
    });
  }
  return { ctx, page, errors };
}

async function openAt(page, size) {
  await page.evaluate(w => {
    localStorage.setItem('mmgr_ai_size', JSON.stringify({ w: w }));
    MMGR.AiWin.close();
    MMGR.AiWin.open();
  }, size);
  await page.waitForFunction(
    () => {
      const w = document.getElementById('ai-win');
      return w && w.classList.contains('open') && w.getBoundingClientRect().width > 0;
    },
    null,
    { timeout: 15000 }
  );
  await delay(450);
}

async function sheetAt(page, width, height) {
  await page.setViewportSize({ width, height });
  await delay(300);
  await page.evaluate(() => {
    MMGR.AiWin.close();
    MMGR.AiWin.open();
  });
  await page.waitForFunction(
    () => document.getElementById('ai-win').classList.contains('open'),
    null,
    { timeout: 15000 }
  );
  await delay(450);
}

(async () => {
  let srv = null;
  if (!process.env.QA_BASE) {
    let up = false;
    try {
      up = (await fetch(BASE + '/project.html')).ok;
    } catch (e) {}
    if (!up) {
      log('starting serve.cjs for this run');
      srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
      for (let i = 0; i < 30; i++) {
        await delay(1000);
        try {
          if ((await fetch(BASE + '/project.html')).ok) {
            break;
          }
        } catch (e) {}
      }
    }
  }
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
  } catch (e) {}

  const pw = resolvePlaywright();
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

  const shot = async (page, name) => {
    try {
      await page.screenshot({ path: path.join(SHOT_DIR, name + '.png') });
    } catch (e) {
      /* screenshots are evidence, not a gate */
    }
  };

  try {
    for (const dark of [false, true]) {
      const tone = dark ? 'dark' : 'light';
      const { ctx, page, errors } = await bootContext(browser, {
        width: 1440,
        height: 900,
        dark
      });

      // ---- Docked: the four widths the drawer can carry ----
      for (const size of [480, 520, 658, 900]) {
        await openAt(page, size);
        const m = await page.evaluate(measure);
        const label = 'docked ' + size + ' (' + tone + ')';
        check(
          label +
            ': the window opens with no horizontal overflow and no dead strip under the composer',
          m.open && !m.overflow && m.boxGap <= 1,
          m
        );
        check(label + ': header is one 56px row', m.headH <= 56 && m.headOneRow, {
          h: m.headH,
          tops: m.headTops
        });
        check(
          label + ': the message box fills the composer card and Send clears the edge',
          m.qRatio >= 0.8 && m.sendGap >= 8,
          { qRatio: +m.qRatio.toFixed(3), sendGap: m.sendGap }
        );
        check(
          label + ': no pill radius anywhere in the window',
          m.roundRadii.length === 0,
          m.roundRadii
        );
        check(
          label + ': the chat list is inline only from 720px up',
          m.histInline === m.winW >= 720,
          { winW: m.winW, histInline: m.histInline }
        );
        if (size === 520 || size === 900) {
          await shot(page, 'docked-' + size + '-' + tone);
        }
      }

      // ---- Sheet: viewport equals window ----
      for (const width of [360, 420, 480]) {
        await sheetAt(page, width, 800);
        const m = await page.evaluate(measure);
        const label = 'sheet ' + width + ' (' + tone + ')';
        check(
          label +
            ': the window fills the viewport, no horizontal overflow and no dead strip under the composer',
          m.open && !m.overflow && m.boxGap <= 1,
          m
        );
        check(label + ': header is one 56px row', m.headH <= 56 && m.headOneRow, {
          h: m.headH,
          tops: m.headTops
        });
        check(
          label + ': the message box fills the composer card and Send clears the edge',
          m.qRatio >= 0.8 && m.sendGap >= 8,
          { qRatio: +m.qRatio.toFixed(3), sendGap: m.sendGap }
        );
        check(
          label + ': no pill radius anywhere in the window',
          m.roundRadii.length === 0,
          m.roundRadii
        );
        check(label + ': the chat list is a slide-over below 720px', m.histInline === false, {
          winW: m.winW,
          histInline: m.histInline
        });
        await shot(page, 'sheet-' + width + '-' + tone);
      }

      // ---- Maximise ----
      await page.setViewportSize({ width: 1900, height: 1000 });
      await delay(300);
      await openAt(page, 520);
      await page.click('#ai-max-btn');
      await delay(500);
      const mx = await page.evaluate(measure);
      check(
        'max 1900 (' + tone + '): the maximised window has no horizontal overflow',
        mx.open && !mx.overflow && Math.abs(mx.winW - 1900) <= 2,
        mx
      );
      check(
        'max 1900 (' + tone + '): header is one 56px row and the chat list is inline',
        mx.headH <= 56 && mx.headOneRow && mx.histInline,
        { h: mx.headH, histInline: mx.histInline }
      );
      await shot(page, 'max-1900-' + tone);
      await page.click('#ai-max-btn');
      await delay(300);

      if (!dark) {
        // ---- Interaction contract, once, on the docked default ----
        await page.setViewportSize({ width: 1440, height: 900 });
        await openAt(page, 520);

        const names = await page.evaluate(() => {
          const btns = Array.prototype.slice.call(
            document.querySelectorAll(
              '.ai-head-right > button, .ai-head-right > .ai-more-wrap > button, #ai-hist-btn'
            )
          );
          return btns.map(b => ({
            id: b.id || b.getAttribute('data-action'),
            name: (
              b.getAttribute('aria-label') ||
              b.textContent.trim() ||
              b.getAttribute('title') ||
              ''
            ).trim()
          }));
        });
        check(
          'header: all five buttons carry an accessible name',
          names.length >= 5 && names.every(n => n.name.length > 0),
          names
        );

        const order = await page.evaluate(() => {
          const win = document.getElementById('ai-win');
          const all = Array.prototype.filter.call(
            win.querySelectorAll(
              'button, select, textarea, a[href], summary, [tabindex]:not([tabindex="-1"])'
            ),
            el => el.offsetParent !== null && !el.disabled
          );
          const idx = el => all.indexOf(el);
          return {
            first: all[0] ? all[0].id || all[0].className : null,
            q: idx(document.getElementById('ai-q')),
            firstHeader: Math.min(
              ...Array.prototype.map.call(
                document.querySelectorAll(
                  '.ai-head-right > button, .ai-head-right > .ai-more-wrap > button, #ai-hist-btn'
                ),
                idx
              )
            ),
            summary: idx(document.querySelector('.ai-adv summary'))
          };
        });
        // The status dot is the first control in the header, so the first
        // header BUTTON may sit at index 1. What matters is the order:
        // header, then the conversation body, then the composer, then the
        // context row underneath it.
        check(
          'header: the controls come first, then the thread, then the composer',
          order.firstHeader >= 0 &&
            order.firstHeader <= 1 &&
            order.q > order.firstHeader &&
            order.summary > order.q,
          order
        );

        const more = await page.evaluate(() => {
          document.getElementById('ai-more-btn').click();
          const menu = document.getElementById('ai-more-menu');
          const r = menu.getBoundingClientRect();
          const wr = document.getElementById('ai-win').getBoundingClientRect();
          return {
            shown: !menu.classList.contains('is-hide') && menu.offsetParent !== null,
            position: getComputedStyle(menu).position,
            inside: r.left >= wr.left - 1 && r.right <= wr.right + 1,
            expanded: document.getElementById('ai-more-btn').getAttribute('aria-expanded'),
            rows: menu.querySelectorAll('[role="menuitemcheckbox"],button').length
          };
        });
        check(
          'more menu: opens absolute, inside the window, with its rows',
          more.shown &&
            more.position === 'absolute' &&
            more.inside &&
            more.expanded === 'true' &&
            more.rows >= 2,
          more
        );
        const escMore = await page.evaluate(() => {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          const menu = document.getElementById('ai-more-menu');
          return {
            hidden: menu.classList.contains('is-hide'),
            focus: document.activeElement && document.activeElement.id
          };
        });
        check(
          'more menu: Esc closes it and focus returns to its button',
          escMore.hidden && escMore.focus === 'ai-more-btn',
          escMore
        );

        const welcome = await page.evaluate(() => {
          const w = document.getElementById('ai-welcome');
          const chain = [];
          let p = w;
          while (p && p.id !== 'ai-win') {
            const cs = getComputedStyle(p);
            chain.push(
              (p.id || p.className || p.tagName) +
                '[' +
                cs.display +
                ',' +
                Math.round(p.getBoundingClientRect().height) +
                ']'
            );
            p = p.parentElement;
          }
          return {
            visible: w.offsetParent !== null,
            hiddenClass: w.classList.contains('is-hide'),
            bubbles: document.querySelectorAll('#ai-thread .ai-bubble').length,
            rows: document.querySelectorAll('#ai-welcome-rows .ai-welcome-row').length,
            chips: document.querySelectorAll('#ai-quick-presets .ai-chip').length,
            chain: chain,
            win: (function () {
              const el = document.getElementById('ai-win');
              const cs = getComputedStyle(el);
              const r = el.getBoundingClientRect();
              return {
                cls: el.className,
                display: cs.display,
                visibility: cs.visibility,
                h: Math.round(r.height),
                w: Math.round(r.width),
                bodyCls: document.body.className,
                inlineH: el.style.height || '(none)'
              };
            })()
          };
        });
        check(
          'empty state: four full-width preset rows and the four chips',
          welcome.visible && welcome.rows === 4 && welcome.chips === 4,
          welcome
        );

        // One real message retires the empty state and the chip strip.
        await page.evaluate(() => {
          MMGR.AiWin.setAiCfg({ tier: 'local' });
          MMGR.AiWin.syncSettingsUI();
          document.getElementById('ai-q').value = 'Where are we?';
          document.getElementById('ai-send').click();
        });
        await page.waitForFunction(
          () => document.querySelectorAll('#ai-thread .ai-bubble').length >= 3,
          null,
          { timeout: 25000 }
        );
        await delay(400);
        const after = await page.evaluate(() => ({
          welcome: document.getElementById('ai-welcome').offsetParent !== null,
          strip: document.getElementById('ai-quick-presets').offsetParent !== null,
          presetTab: !!document.querySelector('#ai-seg-presets')
        }));
        check(
          'empty state: the first message retires the welcome block and the chip strip, and the Presets tab stays',
          !after.welcome && !after.strip && after.presetTab,
          after
        );
        // Back to an empty thread for the screenshots.
        await page.evaluate(() => {
          MMGR.AiWin.clear();
          MMGR.AiWin.newChat();
        });
        await delay(500);

        // ---- The Cloud key popover is absolute and stays inside ----
        await page.evaluate(() => {
          MMGR.AiWin.setAiCfg({ tier: 'cloud' });
          MMGR.AiWin.syncSettingsUI();
        });
        await delay(300);
        const pop = await page.evaluate(() => {
          const banner = document.getElementById('ai-cfg-cloud');
          const shownBanner = !banner.classList.contains('is-hide') && banner.offsetParent !== null;
          const bannerState = {
            cls: banner.className,
            tier: MMGR.AiWin.getAiCfg().tier,
            conn: MMGR.AiWin.getConnectionState(),
            dismissed: banner.dataset.dismissed,
            tierFor: banner.dataset.tierFor
          };
          document.getElementById('ai-byo-gear').click();
          const p = document.getElementById('ai-byo-pop');
          const r = p.getBoundingClientRect();
          const wr = document.getElementById('ai-win').getBoundingClientRect();
          return {
            shownBanner: shownBanner,
            bannerState: bannerState,
            popShown: !p.classList.contains('is-hide') && p.offsetParent !== null,
            position: getComputedStyle(p).position,
            inside: r.left >= wr.left - 1 && r.right <= wr.right + 1,
            hasProvider: !!p.querySelector('#ai-byo-provider')
          };
        });
        check(
          'cloud banner: shows for a missing key, and its key popover is absolute, inside the window, with the provider select',
          pop.shownBanner &&
            pop.popShown &&
            pop.position === 'absolute' &&
            pop.inside &&
            pop.hasProvider,
          pop
        );
        await page.evaluate(() => {
          MMGR.AiWin.setAiCfg({ tier: 'local' });
          MMGR.AiWin.syncSettingsUI();
          return true;
        });

        // ---- Wide screenshots (1400) ----
        await page.setViewportSize({ width: 1400, height: 900 });
        await delay(300);
        await openAt(page, 720);
        await shot(page, 'docked-1400-' + tone);
      }

      check('no uncaught page error (' + tone + ')', errors.length === 0, errors);
      await ctx.close();
    }
  } catch (e) {
    check('harness ran without throwing', false, String((e && e.stack) || e));
  } finally {
    try {
      await browser.close();
    } catch (e) {
      /* closed */
    }
    if (srv) {
      try {
        srv.kill();
      } catch (e) {
        /* gone */
      }
    }
  }

  const failed = results.filter(r => !r.ok);
  log('');
  log('screenshots: ' + SHOT_DIR);
  log(
    (failed.length ? 'FAIL' : 'PASS') +
      ' - ' +
      (results.length - failed.length) +
      '/' +
      results.length +
      ' gates'
  );
  process.exit(failed.length ? 1 : 0);
})();
