#!/usr/bin/env node
/* ============================================================
   tools/qa-ai-dictation.cjs
   GATE: D-2 - AI composer dictation (js/mmgr-voice.js)
   ------------------------------------------------------------
   WHY THIS EXISTS (UI-CI-DIRECTIVE section 4, D-2)
   The AI composer's mic ran the browser Web Speech API, but `onresult` built the
   new base from the LIVE box value, which already held the interim text written
   by the previous event. Interim and final therefore both landed in the box.
   The first event also concatenated `_aiBase` while it was still `null`, so the
   literal word "null" appeared in front of the transcript.

   This gate drives the REAL button (`#ai-voice-btn`) against a stub
   `webkitSpeechRecognition` installed before page scripts run, and asserts on
   `#ai-q`. It covers: interim then final replaces rather than echoes, the word
   null never appears, dictated text appends to typed text, typing during
   dictation is kept, an auto-restart does not duplicate, a final with no
   interim works, a repeated final within 1s commits once, the tooltip is
   accurate, and a stop leaves no `input` listener behind.

   Boot recipe follows tools/qa-ai-win.cjs: the AI window is part of the
   signed-in experience, so the documented `Entitlements.aiAssistant` QA seam is
   installed. The signed-out refusal has its own gate (qa-full).

   Usage:  node tools/qa-ai-dictation.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (browser-app group).
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[ai-dictation] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  log(
    (ok ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (ok ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 6000))
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

/* Runs INSIDE the page, before any page script. Installs the entitlement seam,
   the speech-recognition stub and an `input`-listener spy on the composer. */
function pageBootstrap() {
  // 1. Entitlement seam (same one qa-ai-win.cjs installs).
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

  // 2. Speech recognition stub. `start` and `stop` answer asynchronously, like
  //    the real engine, so a stop cannot restart itself through `onend`.
  window.__dict = {
    starts: 0,
    inst: null,
    added: 0,
    removed: 0
  };
  function StubRecognition() {
    const inst = this;
    inst.continuous = false;
    inst.interimResults = false;
    inst.lang = '';
    inst.start = function () {
      window.__dict.starts++;
      inst.stopped = false;
      setTimeout(function () {
        if (inst.onstart) {
          inst.onstart();
        }
      }, 0);
    };
    inst.stop = function () {
      inst.stopped = true;
      setTimeout(function () {
        if (inst.onend) {
          inst.onend();
        }
      }, 0);
    };
    window.__dict.inst = inst;
  }
  window.webkitSpeechRecognition = StubRecognition;
  window.SpeechRecognition = StubRecognition;

  // 3. Deliver one result list the way the real API shapes it: an array-like
  //    list of arrays, each with `isFinal` and a `[0].transcript`.
  window.__dict.fire = function (resultIndex, items) {
    const inst = window.__dict.inst;
    if (!inst || !inst.onresult) {
      return false;
    }
    const results = items.map(function (it) {
      const row = [{ transcript: it.text }];
      row.isFinal = !!it.final;
      return row;
    });
    inst.onresult({ resultIndex: resultIndex || 0, results: results });
    return true;
  };
  window.__dict.end = function () {
    const inst = window.__dict.inst;
    if (inst && inst.onend) {
      inst.onend();
      return true;
    }
    return false;
  };

  // 4. Listener spy: counts `input` listeners added to / removed from #ai-q, so
  //    the gate can prove a stop leaves nothing attached.
  const q = () => document.getElementById('ai-q');
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (type === 'input' && this === q()) {
      window.__dict.added++;
    }
    return add.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    if (type === 'input' && this === q()) {
      window.__dict.removed++;
    }
    return remove.call(this, type, fn, opts);
  };
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

  /* One booted page with the AI window open and dictation stopped. */
  async function open() {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 200)));
    await page.addInitScript(pageBootstrap);
    await page.goto(BASE + '/seed-test.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(
      () => /\/project(\.html)?$/.test(location.pathname) && window.MMGR && window.MMGR.App,
      null,
      { timeout: 60000 }
    );
    await page.waitForSelector('#ai-q', { state: 'attached', timeout: 30000 });
    await page.waitForFunction(
      () => {
        const fab = document.getElementById('ai-fab');
        return !!fab;
      },
      null,
      { timeout: 30000 }
    );
    await page.evaluate(() => {
      const fab = document.getElementById('ai-fab');
      if (fab) {
        fab.click();
      }
    });
    await page.waitForFunction(
      () => {
        const win = document.getElementById('ai-win');
        return !!win && win.classList.contains('open') && win.getClientRects().length > 0;
      },
      null,
      { timeout: 15000 }
    );
    await delay(250);
    return { ctx, page, errors };
  }

  /* Click the real mic and wait until the app marks the session live. */
  async function startDictation(page) {
    await page.click('#ai-voice-btn');
    await page.waitForFunction(
      () =>
        document.getElementById('ai-voice-btn').classList.contains('recording') &&
        !!(window.__dict && window.__dict.inst),
      null,
      { timeout: 8000 }
    );
  }

  const value = page => page.evaluate(() => document.getElementById('ai-q').value);

  try {
    // --------------------------------------------------------------
    // Gate 1 + 2 + 8: the echo and the phantom null, on one session.
    // --------------------------------------------------------------
    {
      const { ctx, page, errors } = await open();
      const title = await page.getAttribute('#ai-voice-btn', 'title');
      await startDictation(page);

      const seen = [];
      const step = async items => {
        const fired = await page.evaluate(it => window.__dict.fire(0, it), items);
        const v = await value(page);
        seen.push(v);
        return { fired, v };
      };

      const s1 = await step([{ text: "it's", final: false }]);
      const s2 = await step([{ text: "it's echoing", final: false }]);
      const s3 = await step([{ text: "it's echoing", final: true }]);
      check(
        'interim then interim then final leaves exactly the final and never the word null',
        s1.fired &&
          s2.fired &&
          s3.fired &&
          s1.v === "it's" &&
          s2.v === "it's echoing" &&
          s3.v === "it's echoing" &&
          seen.every(v => v.indexOf('null') === -1),
        seen
      );

      const s4 = await step([{ text: 'okay', final: false }]);
      const s5 = await step([{ text: 'okay that', final: true }]);
      check(
        'a second interim plus final appends once: it is exactly "it\'s echoing okay that"',
        s4.v === "it's echoing okay" &&
          s5.v === "it's echoing okay that" &&
          s5.v.indexOf('null') === -1,
        { interim: s4.v, final: s5.v }
      );

      check(
        'the mic tooltip names browser speech recognition, not whisper',
        title === 'Voice input (browser speech recognition)',
        title
      );

      await page.click('#ai-voice-btn');
      await delay(200);
      check('the echo run had no page error', errors.length === 0, errors);
      await ctx.close();
    }

    // --------------------------------------------------------------
    // Gate 3: typed text is the prefix.
    // --------------------------------------------------------------
    {
      const { ctx, page, errors } = await open();
      await page.click('#ai-q');
      await page.keyboard.type('Hello');
      await startDictation(page);
      const v = await page.evaluate(() => {
        window.__dict.fire(0, [{ text: "it's echoing", final: true }]);
        return document.getElementById('ai-q').value;
      });
      check(
        'text typed before the mic is kept as the prefix: "Hello it\'s echoing"',
        v === "Hello it's echoing",
        v
      );
      await page.click('#ai-voice-btn');
      await delay(200);
      check('the typed-prefix run had no page error', errors.length === 0, errors);
      await ctx.close();
    }

    // --------------------------------------------------------------
    // Gate 4: typing mid-dictation is kept, later results append.
    // --------------------------------------------------------------
    {
      const { ctx, page, errors } = await open();
      await page.click('#ai-q');
      await page.keyboard.type('Hello');
      await startDictation(page);
      await page.evaluate(() => window.__dict.fire(0, [{ text: 'first', final: true }]));
      // Real keyboard events (trusted), caret at the end of the composer.
      await page.evaluate(() => {
        const q = document.getElementById('ai-q');
        q.focus();
        q.setSelectionRange(q.value.length, q.value.length);
      });
      await page.keyboard.type(' X');
      const mid = await value(page);
      const after = await page.evaluate(() => {
        window.__dict.fire(0, [{ text: 'second', final: true }]);
        return document.getElementById('ai-q').value;
      });
      check(
        'typing mid-dictation is kept and the next result appends after it',
        mid === 'Hello first X' && after === 'Hello first X second',
        { mid, after }
      );
      await page.click('#ai-voice-btn');
      await delay(200);
      check('the mid-dictation typing run had no page error', errors.length === 0, errors);
      await ctx.close();
    }

    // --------------------------------------------------------------
    // Gate 5 + 6: auto-restart keeps the committed base; a final with no
    // interim works.
    // --------------------------------------------------------------
    {
      const { ctx, page, errors } = await open();
      await startDictation(page);
      const startsBefore = await page.evaluate(() => window.__dict.starts);
      const solo = await page.evaluate(() => {
        window.__dict.fire(0, [{ text: 'alpha', final: true }]);
        return document.getElementById('ai-q').value;
      });
      await page.evaluate(() => window.__dict.end());
      await page.waitForFunction(n => window.__dict.starts > n, startsBefore, { timeout: 8000 });
      const restarted = await page.evaluate(() => window.__dict.starts);
      const afterRestart = await page.evaluate(() => {
        window.__dict.fire(0, [{ text: 'beta', final: true }]);
        return document.getElementById('ai-q').value;
      });
      check(
        'a final with no interim works, and an auto-restart does not duplicate the earlier text',
        solo === 'alpha' && restarted > startsBefore && afterRestart === 'alpha beta',
        { solo, startsBefore, restarted, afterRestart }
      );
      await page.click('#ai-voice-btn');
      await delay(200);
      check('the restart run had no page error', errors.length === 0, errors);
      await ctx.close();
    }

    // --------------------------------------------------------------
    // Gate 7: the same final inside 1s is committed once.
    // --------------------------------------------------------------
    {
      const { ctx, page, errors } = await open();
      await startDictation(page);
      const twice = await page.evaluate(() => {
        window.__dict.fire(0, [{ text: 'dup', final: true }]);
        const first = document.getElementById('ai-q').value;
        window.__dict.fire(0, [{ text: 'dup', final: true }]);
        return { first, second: document.getElementById('ai-q').value };
      });
      check(
        'the same final delivered twice within 1s is committed once',
        twice.first === 'dup' && twice.second === 'dup',
        twice
      );
      await page.click('#ai-voice-btn');
      await delay(200);
      check('the repeat run had no page error', errors.length === 0, errors);
      await ctx.close();
    }

    // --------------------------------------------------------------
    // Gate 9: stop detaches the listener it added.
    // --------------------------------------------------------------
    {
      const { ctx, page, errors } = await open();
      const before = await page.evaluate(() => ({
        added: window.__dict.added,
        removed: window.__dict.removed
      }));
      await startDictation(page);
      const live = await page.evaluate(() => ({
        added: window.__dict.added,
        removed: window.__dict.removed,
        recording: document.getElementById('ai-voice-btn').classList.contains('recording')
      }));
      await page.click('#ai-voice-btn');
      await page.waitForFunction(
        () => !document.getElementById('ai-voice-btn').classList.contains('recording'),
        null,
        { timeout: 8000 }
      );
      await delay(150);
      const done = await page.evaluate(() => ({
        added: window.__dict.added,
        removed: window.__dict.removed
      }));
      check(
        'starting adds exactly one input listener and stopping removes that one',
        live.recording &&
          live.added - before.added === 1 &&
          done.added - live.added === 0 &&
          done.removed - live.removed === 1 &&
          done.added === done.removed,
        { before, live, done }
      );
      check('the listener run had no page error', errors.length === 0, errors);
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
