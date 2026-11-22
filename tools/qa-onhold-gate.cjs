/* ============================================================
   tools/qa-onhold-gate.cjs - an on-hold project asks before it is changed
   ------------------------------------------------------------
   UI-WAVE 2026-11-20 L. Owner decision: in-app banner only (no email, no
   server event) plus a deliberate acknowledgement before edits, never a hard
   server lock.

   Gates:
     O1 an on-hold project shows the banner when it opens.
     O2 the banner carries the owner's sentence and the one way out.
     O3 a mutating action is refused while the banner is unacknowledged, and
        the project is unchanged.
     O4 "Finalize and continue" unlocks it and the same action then applies.
     O5 the acknowledgement survives a reload.
     O6 the acknowledgement is per project, not per device.
     O7 no page error throughout.

   Usage:   node tools/qa-onhold-gate.cjs
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
const log = s => process.stdout.write('[qa-onhold] ' + s + '\n');
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

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(`try {
      localStorage.setItem('mmgr_unlocked_demo-project', '1');
      localStorage.setItem('mmgr_first_project_tour_v1', '1');
    } catch (e) {}`);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '/project.html?id=demo-project', { waitUntil: 'domcontentloaded' });
    await delay(1400);

    // ---- O1/O2: the banner on open -------------------------------------
    const shown = await page.evaluate(async () => {
      MMGR.State.updateState(s => {
        s.status = 'on-hold';
      });
      MMGR.Render.renderStatusChip();
      await new Promise(r => setTimeout(r, 150));
      const bar = document.getElementById('onhold-banner');
      const cs = bar ? getComputedStyle(bar) : null;
      return {
        exists: !!bar,
        hidden: bar ? bar.classList.contains('is-hide') : null,
        height: bar ? Math.round(bar.getBoundingClientRect().height) : 0,
        display: cs ? cs.display : null,
        text: bar ? bar.textContent.replace(/\s+/g, ' ').trim() : '',
        btn: bar ? !!bar.querySelector('[data-action="onholdFinalize"]') : false,
        inHeader: bar ? !!bar.closest('#app-header') : false,
        locked: MMGR.OnHold.locked(),
        onHold: MMGR.OnHold.onHold()
      };
    });
    check(
      'O1 an on-hold project shows the banner when it opens',
      shown.exists &&
        shown.hidden === false &&
        shown.height > 0 &&
        shown.display !== 'none' &&
        shown.inHeader === true &&
        shown.onHold === true &&
        shown.locked === true,
      shown
    );
    check(
      'O2 the banner carries the owner sentence and the one way out',
      /This project was put on hold\. Finalize before making changes\./.test(shown.text) &&
        shown.btn === true,
      shown
    );

    // ---- O3: a mutating action is refused ------------------------------
    const refused = await page.evaluate(async () => {
      // A throwaway control with a real mutating action. setProjStatus is the
      // smallest one that leaves an observable mark in state.
      const b = document.createElement('button');
      b.id = 'qa-hold-probe';
      b.setAttribute('data-action', 'setProjStatus');
      b.setAttribute('data-status', 'active');
      b.textContent = 'probe';
      document.body.appendChild(b);
      b.click();
      await new Promise(r => setTimeout(r, 200));
      const out = {
        status: MMGR.State.getState().status,
        stillLocked: MMGR.OnHold.locked(),
        toast: (document.querySelector('.toast, #toast') || {}).textContent || ''
      };
      b.remove();
      return out;
    });
    check(
      'O3 a mutating action is refused while the banner is unacknowledged',
      refused.status === 'on-hold' && refused.stillLocked === true,
      refused
    );

    // ---- O4: finalize unlocks it ---------------------------------------
    const unlocked = await page.evaluate(async () => {
      const btn = document.querySelector('#onhold-banner [data-action="onholdFinalize"]');
      btn.click();
      await new Promise(r => setTimeout(r, 200));
      const afterAck = {
        locked: MMGR.OnHold.locked(),
        acked: MMGR.OnHold.acknowledged(),
        barHidden: document.getElementById('onhold-banner').classList.contains('is-hide')
      };
      const b = document.createElement('button');
      b.id = 'qa-hold-probe2';
      b.setAttribute('data-action', 'setProjStatus');
      b.setAttribute('data-status', 'active');
      document.body.appendChild(b);
      b.click();
      await new Promise(r => setTimeout(r, 200));
      const afterEdit = { status: MMGR.State.getState().status };
      b.remove();
      return { afterAck: afterAck, afterEdit: afterEdit };
    });
    check(
      'O4 "Finalize and continue" unlocks it and the same action then applies',
      unlocked.afterAck.locked === false &&
        unlocked.afterAck.acked === true &&
        unlocked.afterEdit.status === 'active',
      unlocked
    );

    // ---- O5/O6: survives a reload, scoped to this project --------------
    const ackState = await page.evaluate(async () => {
      MMGR.State.updateState(s => {
        s.status = 'on-hold';
      });
      MMGR.Render.renderStatusChip();
      await new Promise(r => setTimeout(r, 150));
      const keys = Object.keys(localStorage).filter(k => k.indexOf('mmgr_onhold_ack_') === 0);
      return {
        locked: MMGR.OnHold.locked(),
        keys: keys,
        pid: MMGR.State.getState().projectId
      };
    });
    check(
      'O5 the acknowledgement survives a status re-read (no re-lock)',
      ackState.locked === false,
      ackState
    );
    check(
      'O6 the acknowledgement is stored per project',
      ackState.keys.length === 1 && ackState.keys[0] === 'mmgr_onhold_ack_' + ackState.pid,
      ackState
    );

    // Reload the page: the acknowledgement must still hold.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await delay(1500);
    const afterReload = await page.evaluate(() => ({
      locked: MMGR.OnHold.locked(),
      onHold: MMGR.OnHold.onHold(),
      barHidden: document.getElementById('onhold-banner').classList.contains('is-hide')
    }));
    check(
      'O5b the acknowledgement survives a reload',
      afterReload.locked === false && afterReload.onHold === true,
      afterReload
    );

    check('O7 no page error throughout', errors.length === 0, errors);

    await ctx.close();
    await browser.close();
    browser = null;
    if (srv) {
      try {
        srv.kill();
      } catch (e) {}
    }
    log('RESULT ' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  } catch (e) {
    if (browser) {
      try {
        await browser.close();
      } catch (err) {}
    }
    if (srv) {
      try {
        srv.kill();
      } catch (err) {}
    }
    log('HARNESS ERROR ' + String((e && e.stack) || e).slice(0, 900));
    process.exit(1);
  }
})();
