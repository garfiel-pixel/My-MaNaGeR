#!/usr/bin/env node
/* ============================================================
   tools/qa-landing-ai.cjs - C2 (audit 2026-11-01)
   ------------------------------------------------------------
   C2 asked for a landing-page AI a visitor can talk to: it explains what the
   product does, asks qualifying questions (AI proficiency, MCP appetite), and
   only becomes interactive once it is ready. It must be lazy (nothing loads
   until the section is close or the visitor acts), show a loading state rather
   than a dead box, and degrade to "open the app" with no network.

   This gate proves, in a real browser on index.html:
     - LAZY / LCP: at first paint the assistant module is NOT in the DOM and
       #landing-ai is still idle, so the widget cannot be the LCP;
     - WAIT: scrolling #try-ai into view loads the module, which passes through
       a loading phase before becoming interactive;
     - ANSWERS: the intro appears, the composer turns on, and tapping a starter
       chip produces an assistant answer plus the qualifying chips;
     - NO EARLY REQUEST: no /api/ai/chat call is made before the visitor acts;
     - OFFLINE: with navigator.onLine false the widget takes the offline branch,
       offers "Open the app", and never calls /api/ai/chat.

   Teeth: make the loader inject eagerly -> the lazy/LCP arm fails. Remove the
   loading delay -> the "saw loading" arm fails. Call the relay on mount -> the
   no-early-request arm fails. Drop the offline branch -> the offline arm fails.

   Usage:  node tools/qa-landing-ai.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row (browser-marketing).
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[landing-ai] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  log(
    (ok ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (ok ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 400))
  );
};

function resolvePlaywright() {
  try {
    return require('playwright');
  } catch (e) {
    const alt = path.join(ROOT, 'node_modules', 'playwright');
    if (fs.existsSync(alt)) return require(alt);
    throw e;
  }
}

(async () => {
  let srv = null;
  try {
    const h = await fetch(BASE + '/index.html');
    if (!h.ok) throw new Error('not ok');
  } catch (e) {
    log('starting serve.cjs for this run');
    srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 40; i++) {
      await delay(1000);
      try {
        const h = await fetch(BASE + '/index.html');
        if (h.ok) break;
      } catch (err) {
        /* still starting */
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

  try {
    /* ---- online arm ---------------------------------------------------- */
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    const aiCalls = [];
    const errors = [];
    page.on('request', req => {
      if (String(req.url()).indexOf('/api/ai/chat') > -1) aiCalls.push(req.url());
    });
    page.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 160)));

    await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => !!document.body, null, { timeout: 45000 });
    await delay(300);

    const atLoad = await page.evaluate(() => {
      const mount = document.getElementById('landing-ai');
      return {
        hero: !!document.querySelector('main .hero h1'),
        mountPresent: !!mount,
        phase: mount ? mount.getAttribute('data-lai-phase') : null,
        moduleLoaded: !!document.querySelector('script[src*="marketing-ai"]'),
        fallback: !!(mount && mount.querySelector('.landing-ai-fallback'))
      };
    });
    check('hero headline is present', atLoad.hero);
    check('#landing-ai mount node is present', atLoad.mountPresent);
    check('assistant module is NOT loaded at first paint (cannot be LCP)', !atLoad.moduleLoaded);
    check('mount is idle at first paint', atLoad.phase === 'idle', atLoad.phase);
    check('static Open the app fallback is present before load', atLoad.fallback);

    // Scroll the section into view: the lazy loader should inject the module.
    await page.evaluate(() => {
      const s = document.getElementById('try-ai');
      if (s) s.scrollIntoView({ block: 'center' });
    });
    await page.waitForFunction(
      () => {
        const m = document.getElementById('landing-ai');
        return !!m && m.getAttribute('data-lai-phase') === 'ready';
      },
      null,
      { timeout: 25000 }
    );

    const afterLoad = await page.evaluate(() => {
      const m = document.getElementById('landing-ai');
      return {
        phase: m.getAttribute('data-lai-phase'),
        sawLoading: m.getAttribute('data-lai-saw-loading') === '1',
        moduleLoaded: !!document.querySelector('script[src*="marketing-ai"]'),
        intro: !!m.querySelector('.lai-msg.ai .lai-text'),
        chips: m.querySelectorAll('.lai-chip[data-lai-ask]').length,
        inputEnabled: !!m.querySelector('.lai-input') && !m.querySelector('.lai-input').disabled,
        status: (m.querySelector('.lai-status') || {}).textContent || ''
      };
    });
    check('module loaded after the section neared the viewport', afterLoad.moduleLoaded);
    check('widget passed through a loading phase before ready', afterLoad.sawLoading);
    check('widget is ready and interactive', afterLoad.phase === 'ready' && afterLoad.inputEnabled);
    check('intro answer is shown', afterLoad.intro);
    check('starter question chips are shown', afterLoad.chips >= 3, afterLoad.chips);
    check('no /api/ai/chat call before interaction', aiCalls.length === 0, aiCalls);

    // Tap a starter chip: a local answer plus the qualifying questions.
    await page.evaluate(() => {
      const b = document.querySelector('#landing-ai .lai-chip[data-lai-ask]');
      if (b) b.click();
    });
    await delay(250);
    const afterAsk = await page.evaluate(() => {
      const m = document.getElementById('landing-ai');
      const answers = m.querySelectorAll('.lai-msg.ai .lai-text');
      const qual = m.querySelectorAll('.lai-chip[data-lai-qual]');
      return {
        answers: answers.length,
        lastAnswer: answers.length ? answers[answers.length - 1].textContent : '',
        qual: qual.length
      };
    });
    check('tapping a chip produces an assistant answer', afterAsk.answers >= 2, afterAsk.answers);
    check(
      'the answer explains the product',
      /workspace|construction|project/i.test(afterAsk.lastAnswer),
      afterAsk.lastAnswer.slice(0, 80)
    );
    check('qualifying questions appear after the first answer', afterAsk.qual >= 3, afterAsk.qual);
    check('local answer still makes no /api/ai/chat call', aiCalls.length === 0, aiCalls);
    check('no uncaught page errors (online)', errors.length === 0, errors);

    await ctx.close();

    /* ---- offline arm --------------------------------------------------- */
    const offCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    await offCtx.addInitScript(() => {
      try {
        Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
      } catch (e) {
        /* ignore */
      }
    });
    const offPage = await offCtx.newPage();
    const offAiCalls = [];
    offPage.on('request', req => {
      if (String(req.url()).indexOf('/api/ai/chat') > -1) offAiCalls.push(req.url());
    });
    await offPage.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
    await offPage.waitForFunction(() => !!document.body, null, { timeout: 45000 });
    await offPage.evaluate(() => {
      const s = document.getElementById('try-ai');
      if (s) s.scrollIntoView({ block: 'center' });
    });
    await offPage.waitForFunction(
      () => {
        const m = document.getElementById('landing-ai');
        return !!m && m.getAttribute('data-lai-phase') === 'offline';
      },
      null,
      { timeout: 25000 }
    );
    const offline = await offPage.evaluate(() => {
      const m = document.getElementById('landing-ai');
      return {
        phase: m.getAttribute('data-lai-phase'),
        openChip: !!m.querySelector('.lai-chip-go'),
        saidOffline: /offline/i.test(m.textContent || '')
      };
    });
    check('offline: widget takes the offline branch', offline.phase === 'offline', offline.phase);
    check('offline: it says so', offline.saidOffline);
    check('offline: it offers Open the app', offline.openChip);
    check('offline: no /api/ai/chat call', offAiCalls.length === 0, offAiCalls);

    await offCtx.close();

    const passed = results.filter(r => r.ok).length;
    const total = results.length;
    log('');
    if (passed === total) {
      log('ALL GREEN - ' + passed + '/' + total + ' gates');
    } else {
      log('FAILED - ' + passed + '/' + total + ' gates');
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    if (srv) srv.kill();
  }
})().catch(e => {
  log('harness error: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
