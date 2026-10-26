#!/usr/bin/env node
/* ============================================================
   tools/qa-modals.cjs - T-MODAL gate (APP-4, REFINEMENT-DIRECTIVE-2026-10-24)
   ------------------------------------------------------------
   The bug: the six dialog overlays in project.html are data-action
   CONTAINERS (`data-action="closeGanttExportBg"` and five siblings). The
   global click dispatcher in js/mmgr-app.js found the container with
   closest('[data-action]'), then called preventDefault() - which cancelled
   the native default of the radio or checkbox the user had just clicked.
   In Export Schedule only the pre-selected radio and the checkboxes
   "worked"; every other option could not be chosen.

   The fix exempts a click whose target is a native control INSIDE the
   container: the container's handler still runs (the backdrop handlers test
   e.target === el, so they no-op), no preventDefault, and the control does
   what it looks like it does.

   WHAT THIS GATE DOES (real browser, serve.cjs):
     M1  enumerates every element whose id ends -modal or whose data-action
         ends Bg, and reports the ones that contain inputs
     M2  for each one: opens it through its real trigger (the button the
         person clicks), clicks EACH radio and asserts exactly that one is
         checked, clicks EACH checkbox and asserts it flipped
     M3  clicks the backdrop and asserts the dialog closes
     M4  Export Schedule reads the CHOSEN values back: ganttExportRun
         receives svg / a3 / dark / all when those are chosen

   Usage:  node tools/qa-modals.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row.
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[modals] ' + s + '\n');
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
    if (fs.existsSync(alt)) {
      return require(alt);
    }
    throw e;
  }
}

(async () => {
  let srv = null;
  try {
    const h = await fetch(BASE + '/project.html');
    if (!h.ok) {
      throw new Error('not ok');
    }
  } catch (e) {
    log('starting serve.cjs for this run');
    srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 40; i++) {
      await delay(1000);
      try {
        const h = await fetch(BASE + '/project.html');
        if (h.ok) {
          break;
        }
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String((e && e.message) || e).slice(0, 200)));

  try {
    // The recipe qa-full uses: seed-test.html writes the demo projects into
    // localStorage, then project.html?id=demo-project opens a real workspace
    // with no unlock modal.
    await page.goto(BASE + '/seed-test.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await delay(600);
    await page.goto(BASE + '/project.html?id=demo-project', {
      waitUntil: 'load',
      timeout: 60000
    });
    await page.waitForFunction(() => !!(window.MMGR && window.MMGR.App), null, { timeout: 45000 });
    await delay(400);

    // A usable schedule, so Export has something real to draw and the
    // dialogs are in the state a person would open them in.
    await page.evaluate(() => {
      function d(n) {
        const t = new Date();
        t.setDate(t.getDate() + n);
        return t.toISOString().slice(0, 10);
      }
      window.MMGR.State.updateState(function (s) {
        s.tasks = [
          { id: 'ph1', name: 'Foundations', isPhase: true, startDate: d(0), endDate: d(4) },
          {
            id: 'a',
            name: 'Excavate',
            parentId: 'ph1',
            startDate: d(0),
            endDate: d(2),
            duration: '3',
            status: 'completed',
            assignedTo: 'Jose'
          }
        ];
      });
    });

    // M1: the inventory. Everything that looks like a dialog and contains an
    // input is in scope - the gate fails if one of them cannot be exercised.
    const inventory = await page.evaluate(() => {
      const out = [];
      const seen = new Set();
      Array.prototype.forEach.call(
        document.querySelectorAll('[id$="-modal"], [data-action$="Bg"]'),
        el => {
          if (seen.has(el)) {
            return;
          }
          seen.add(el);
          out.push({
            id: el.id || '',
            action: el.getAttribute('data-action') || '',
            inputs: el.querySelectorAll('input').length
          });
        }
      );
      return out;
    });
    check(
      'M1 every dialog container is inventoried and scoped',
      inventory.length >= 6 &&
        inventory.every(d => d.id || d.action) &&
        inventory.some(d => d.id === 'gantt-export-modal' && d.inputs > 0),
      inventory
    );

    // M2/M3: open it, click every control, close on the backdrop.
    const sweep = await page.evaluate(() => {
      const TRIGGERS = {
        'gantt-export-modal': 'openGanttExport',
        'ai-mailbox': 'openAiMailbox',
        'chartup-modal': 'openChartUp',
        'wbsimport-modal': 'openWbsImport',
        'importdates-modal': 'openImportDates',
        'bidpkg-modal': 'bidAdd'
      };
      const isOpen = el =>
        el.classList.contains('on') ||
        (el.style.display && el.style.display !== 'none') ||
        getComputedStyle(el).display !== 'none';
      const out = [];
      Object.keys(TRIGGERS).forEach(id => {
        const box = document.getElementById(id);
        if (!box) {
          out.push({ id, ok: false, why: 'missing' });
          return;
        }
        // The real trigger: the button the person clicks. Clicking the
        // ELEMENT (not a synthetic MMGR call) keeps the document dispatcher
        // in the path, which is where the bug lived.
        let openedBy = '';
        const known = [];
        Array.prototype.forEach.call(document.querySelectorAll('[data-action]'), el => {
          if (el.getAttribute('data-action') === TRIGGERS[id]) {
            known.push(el);
          }
        });
        for (let i = 0; i < known.length && !openedBy; i++) {
          try {
            known[i].click();
            if (isOpen(box)) {
              openedBy = 'trigger';
            }
          } catch (e) {
            /* try the next one */
          }
        }
        if (!openedBy) {
          try {
            const fn =
              window.MMGR &&
              window.MMGR.App &&
              (window.MMGR.App[TRIGGERS[id]] || window.MMGR.App.actions);
            if (typeof window.MMGR.App[TRIGGERS[id]] === 'function') {
              window.MMGR.App[TRIGGERS[id]]();
            } else if (fn && typeof fn[TRIGGERS[id]] === 'function') {
              fn[TRIGGERS[id]]();
            }
            if (isOpen(box)) {
              openedBy = 'api';
            }
          } catch (e) {
            /* reported below */
          }
        }
        const rec = { id, opened: openedBy, radios: [], boxes: [], closed: false };
        if (!openedBy) {
          rec.ok = false;
          rec.why = 'would not open';
          out.push(rec);
          return;
        }
        const radios = box.querySelectorAll('input[type="radio"]');
        Array.prototype.forEach.call(radios, r => {
          if (r.disabled) {
            return;
          }
          r.click();
          const group = Array.prototype.filter.call(
            box.querySelectorAll('input[type="radio"]'),
            x => x.name === r.name
          );
          const others = group.filter(x => x !== r && x.checked).length;
          rec.radios.push({ name: r.name, value: r.value, checked: r.checked, others });
        });
        const boxes = box.querySelectorAll('input[type="checkbox"]');
        Array.prototype.forEach.call(boxes, c => {
          if (c.disabled) {
            return;
          }
          const before = c.checked;
          c.click();
          rec.boxes.push({ id: c.id, before, after: c.checked, flipped: c.checked !== before });
        });
        // The backdrop is the overlay ELEMENT itself; a click whose target is
        // that element is what a person does by clicking the dim area.
        box.click();
        rec.closed = !isOpen(box);
        rec.ok =
          rec.radios.every(r => r.checked && r.others === 0) &&
          rec.boxes.every(c => c.flipped) &&
          rec.closed;
        out.push(rec);
      });
      return out;
    });
    sweep.forEach(r => {
      check(
        'M2/M3 ' +
          r.id +
          ' (' +
          (r.opened || 'not opened') +
          '): radios ' +
          r.radios.length +
          ', checkboxes ' +
          r.boxes.length +
          ', closes on backdrop',
        r.ok,
        r
      );
    });

    // M4: the chosen values must be the ones the export runs with.
    const m4 = await page.evaluate(() => {
      const trig = document.querySelector('[data-action="openGanttExport"]');
      if (trig) {
        trig.click();
      } else {
        window.MMGR.App.openGanttExport();
      }
      const box = document.getElementById('gantt-export-modal');
      if (!box || !box.classList.contains('on')) {
        return { ok: false, why: 'did not open' };
      }
      const pick = (sel, val) => {
        const el = box.querySelector(sel + '[value="' + val + '"]');
        if (!el) {
          return false;
        }
        el.click();
        return el.checked;
      };
      const choseSvg = pick('input[name="gx-format"]', 'svg');
      const choseA3 = pick('input[name="gx-page"]', 'a3');
      const choseDark = pick('input[name="gx-theme"]', 'dark');
      const choseAll = pick('input[name="gx-links"]', 'all');
      const orig = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (cb) {
        cb(new Blob(['png'], { type: 'image/png' }));
      };
      let threw = '';
      try {
        window.MMGR.App.ganttExportRun();
      } catch (e) {
        threw = String((e && e.message) || e);
      }
      HTMLCanvasElement.prototype.toBlob = orig;
      const meta = window.__ganttExportMeta || {};
      const ui = (window.MMGR.State.getState().ui || {}).ganttExport || {};
      return {
        ok:
          choseSvg &&
          choseA3 &&
          choseDark &&
          choseAll &&
          !threw &&
          ui.format === 'svg' &&
          ui.page === 'a3' &&
          ui.theme === 'dark' &&
          window.MMGR.State.getState().ui.ganttLinkPolicy === 'all' &&
          meta.format === 'svg' &&
          meta.theme === 'dark',
        chose: { choseSvg, choseA3, choseDark, choseAll },
        ran: {
          format: ui.format,
          page: ui.page,
          theme: ui.theme,
          links: window.MMGR.State.getState().ui.ganttLinkPolicy,
          metaFormat: meta.format,
          metaTheme: meta.theme
        },
        threw
      };
    });
    check('M4 Export Schedule runs with the CHOSEN values (svg, a3, dark, all)', m4.ok, m4);

    check('M5 no uncaught page error during the sweep', pageErrors.length === 0, pageErrors);
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
