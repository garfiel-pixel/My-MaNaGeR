/* ============================================================
   tools/qa-ai-viewonly.cjs - the assistant is unavailable on view-only projects
   ------------------------------------------------------------
   UX-2026-11-19 close-out Step 3a (owner decision). The AI is NOT
   available when the project is view-only for the user, and they are
   told BEFORE typing. The exact wording differs by why the project is
   read-only:

     demo project
       "This project is view-only for you, so the AI assistant is not
        available here. Create your own project to use the AI."

     viewer role in someone else's project
       "This project is view-only for you, so the AI assistant is not
        available here. Ask the project owner for edit access, or create
        your own project to use the AI."

   Both notices carry a 44px "Create a project" button that opens the
   new-project flow (admin.html?new=1). The composer, Send, voice, the
   tier select, the Presets tab and every preset button are disabled.
   An AI action never produces the generic "View-only mode" toast.
   Editors see no change.

   This replaces the earlier A6 contract (aiRun/aiRunPreset allowed in
   view-only mode), which the owner explicitly reversed.

   Gates:
     V1 the demo fixture really is a view-only session.
     V2 the dashboard Ask card shows the demo notice before typing, with
        the exact text, a 44px Create-a-project link, and disabled controls.
     V3 opening the assistant shows the same notice; the composer, Send,
        voice, tier and Presets tab are disabled; every preset is disabled.
     V4 clicking Send / calling runQuestion never produces a "View-only
        mode" toast.
     V5 a non-demo project opened read-only shows the viewer wording.
     V6 an editor sees no notice and the assistant controls stay enabled.
     V7 the guard still bites: a project-writing action (addRisk) shows
        the view-only toast.

   Usage:   node tools/qa-ai-viewonly.cjs
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
const log = s => process.stdout.write('[qa-ai-viewonly] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));

const DEMO_MSG =
  'This project is view-only for you, so the AI assistant is not available here. ' +
  'Create your own project to use the AI.';
const VIEWER_MSG =
  'This project is view-only for you, so the AI assistant is not available here. ' +
  'Ask the project owner for edit access, or create your own project to use the AI.';

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

const norm = s =>
  String(s || '')
    .replace(/\s+/g, ' ')
    .trim();

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

// Every toast text this page shows, in order. Toasts are created and removed,
// so a snapshot read would miss the refusal.
const WATCH_TOASTS = `(function () {
  window.__toasts = [];
  var push = function (t) {
    if (t && window.__toasts.indexOf(t) === -1) window.__toasts.push(t);
  };
  var scan = function () {
    var t = document.querySelector('.toast');
    if (t) push((t.textContent || '').trim());
  };
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
})();`;

// Read the dashboard Ask card + the assistant panel in one pass.
const READ_ASK = `(function () {
  var card = document.getElementById('ai-command-card');
  var msg = card ? card.querySelector('.ai-viewonly-msg') : null;
  var cta = card ? card.querySelector('.ai-viewonly-cta') : null;
  var inp = document.getElementById('ai-command-input');
  var btn = document.getElementById('ai-command-btn');
  return {
    text: msg ? (msg.textContent || '') : '',
    ctaHref: cta ? cta.getAttribute('href') : '',
    ctaH: cta ? Math.round(cta.getBoundingClientRect().height) : 0,
    ctaMin: cta ? (getComputedStyle(cta).minHeight || '') : '',
    inputDisabled: !!(inp && inp.disabled),
    btnDisabled: !!(btn && btn.disabled),
    hasNotice: !!msg
  };
})()`;

const READ_PANEL = `(function () {
  var win = document.getElementById('ai-win');
  var note = win ? win.querySelector('#ai-viewonly .ai-viewonly-msg') : null;
  var q = document.getElementById('ai-q');
  var send = document.getElementById('ai-send');
  var voice = document.getElementById('ai-voice-btn');
  var tier = document.getElementById('ai-tier');
  var seg = document.getElementById('ai-seg-presets');
  var btns = win
    ? Array.prototype.slice.call(
        win.querySelectorAll('[data-action="aiPreset"],[data-action="aiRunPreset"]')
      )
    : [];
  return {
    open: !!(win && win.classList.contains('open')),
    voMode: !!(win && win.classList.contains('ai-viewonly-mode')),
    text: note ? (note.textContent || '') : '',
    qDisabled: !!(q && q.disabled),
    sendDisabled: !!(send && send.disabled),
    voiceDisabled: !!(voice && voice.disabled),
    tierDisabled: !!(tier && tier.disabled),
    segDisabled: !!(seg && seg.disabled),
    presetCount: btns.length,
    presetEnabled: btns.filter(function (b) { return !b.disabled; }).length
  };
})()`;

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

    async function fixture(init, url) {
      const page = await ctx.newPage();
      await page.addInitScript(init);
      await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
      await page.evaluate(FLUSH_RAF);
      await delay(1200);
      await page.evaluate(WATCH_TOASTS);
      return page;
    }

    // ---- V1/V2: the demo project -----------------------------------
    const demo = await fixture(
      `try {
        localStorage.setItem('mmgr_unlocked_demo-filled', '1');
        localStorage.removeItem('mmgr_scope_demo-filled');
      } catch (e) {}`,
      '/project.html?id=demo-filled'
    );

    const ro = await demo.evaluate(
      () => !!(window.MMGR && MMGR.App && MMGR.App.isReadonly && MMGR.App.isReadonly())
    );
    check('V1 the demo fixture is a view-only session', ro === true, ro);

    const ask = await demo.evaluate(READ_ASK);
    check('V2a the demo notice is shown before typing', norm(ask.text) === DEMO_MSG, ask.text);
    check(
      'V2b the Create-a-project link opens the new-project flow',
      /admin\.html\?new=1/.test(ask.ctaHref),
      ask.ctaHref
    );
    check('V2c the Create-a-project button is 44px', ask.ctaH >= 44 || ask.ctaMin === '44px', ask);
    check('V2d the Ask input is disabled', ask.inputDisabled === true, ask);
    check('V2e the Ask button is disabled', ask.btnDisabled === true, ask);

    // ---- V3/V4: the assistant panel ---------------------------------
    await demo.evaluate(() => {
      if (window.MMGR && MMGR.AiWin) {
        MMGR.AiWin.open();
      }
    });
    await demo.evaluate(FLUSH_RAF);
    await delay(600);
    const panel = await demo.evaluate(READ_PANEL);
    check('V3a the assistant panel opens with the notice', panel.open && panel.voMode, panel);
    check('V3b the panel shows the demo wording', norm(panel.text) === DEMO_MSG, panel.text);
    check('V3c the composer is disabled', panel.qDisabled === true, panel);
    check('V3d Send is disabled', panel.sendDisabled === true, panel);
    check('V3e voice input is disabled', panel.voiceDisabled === true, panel);
    check('V3f the tier select is disabled', panel.tierDisabled === true, panel);
    check('V3g the Presets tab is disabled', panel.segDisabled === true, panel);
    check('V3h presets are rendered', panel.presetCount >= 1, panel);
    check('V3i every preset is disabled', panel.presetEnabled === 0, panel);

    await demo.evaluate(() => {
      window.__toasts.length = 0;
      const send = document.getElementById('ai-send');
      if (send) {
        send.click();
      }
      if (window.MMGR && MMGR.AiWin && MMGR.AiWin.runQuestion) {
        MMGR.AiWin.runQuestion();
      }
    });
    await delay(700);
    let toasts = await demo.evaluate('window.__toasts || []');
    check(
      'V4 an AI action never shows the view-only toast',
      toasts.filter(t => /view-only/i.test(t)).length === 0,
      toasts
    );

    // ---- V7: the guard still bites ----------------------------------
    await demo.evaluate(() => {
      window.__toasts.length = 0;
      const b = document.querySelector('[data-action="addRisk"]');
      if (b) {
        b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
    await demo.evaluate(FLUSH_RAF);
    await delay(500);
    toasts = await demo.evaluate('window.__toasts || []');
    check(
      'V7 a project-writing action is still refused in view-only mode',
      toasts.some(t => /view-only/i.test(t)),
      toasts
    );
    await demo.close();

    // ---- V5: viewer role in someone else's project ------------------
    const viewer = await fixture(
      `try {
        localStorage.setItem('mmgr_unlocked_viewer-fixture', '1');
        localStorage.setItem('mmgr_scope_viewer-fixture', 'readonly');
      } catch (e) {}`,
      '/project.html?id=viewer-fixture'
    );
    const vro = await viewer.evaluate(
      () => !!(window.MMGR && MMGR.App && MMGR.App.isReadonly && MMGR.App.isReadonly())
    );
    check('V5a the viewer fixture is a view-only session', vro === true, vro);
    const vask = await viewer.evaluate(READ_ASK);
    check(
      'V5b the viewer wording is shown before typing',
      norm(vask.text) === VIEWER_MSG,
      vask.text
    );
    check(
      'V5c the viewer notice still offers Create a project',
      /admin\.html\?new=1/.test(vask.ctaHref),
      vask.ctaHref
    );
    await viewer.evaluate(() => {
      if (window.MMGR && MMGR.AiWin) {
        MMGR.AiWin.open();
      }
    });
    await viewer.evaluate(FLUSH_RAF);
    await delay(600);
    const vpanel = await viewer.evaluate(READ_PANEL);
    check('V5d the panel shows the viewer wording', norm(vpanel.text) === VIEWER_MSG, vpanel.text);
    await viewer.close();

    // ---- V6: an editor sees no change -------------------------------
    const editor = await fixture(
      `try {
        localStorage.setItem('mmgr_unlocked_editor-fixture', '1');
        localStorage.setItem('mmgr_scope_editor-fixture', 'full');
      } catch (e) {}`,
      '/project.html?id=editor-fixture'
    );
    const ero = await editor.evaluate(
      () => !!(window.MMGR && MMGR.App && MMGR.App.isReadonly && MMGR.App.isReadonly())
    );
    check('V6a the editor fixture is editable', ero === false, ero);
    const eask = await editor.evaluate(READ_ASK);
    check('V6b the editor sees no view-only notice', eask.hasNotice === false, eask);
    check('V6c the editor Ask input stays enabled', eask.inputDisabled === false, eask);
    await editor.evaluate(() => {
      if (window.MMGR && MMGR.Entitlements) {
        MMGR.Entitlements.aiAssistant = function () {
          return true;
        };
      }
      if (window.MMGR && MMGR.AiWin) {
        MMGR.AiWin.open();
      }
    });
    await editor.evaluate(FLUSH_RAF);
    await delay(600);
    const epanel = await editor.evaluate(READ_PANEL);
    check('V6d the editor assistant opens without the notice', epanel.voMode === false, epanel);
    check('V6e the editor composer stays enabled', epanel.qDisabled === false, epanel);
    await editor.close();

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
