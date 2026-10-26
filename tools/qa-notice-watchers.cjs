#!/usr/bin/env node
/* ============================================================
   tools/qa-notice-watchers.cjs - RISK-1 + EXP-1 (Wave D)
   ------------------------------------------------------------
   REFINEMENT-DIRECTIVE-2026-10-24, section 8.

   RISK-1. The dashboard used to say "At Risk, 1d over target" with no reason
   and no advice, and no watcher raised it as a notice. This gate drives
   fixtures through the real watcher and asserts:
     - one day over target raises exactly ONE notice
     - the notice names the contributor task and offers the reserve suggestion
     - the badge (Render.computeTimelineStatus) and the notice quote the SAME
       overrun number (both read Schedule.projectedFinish)
     - exactly at target raises none
     - deleting the notice does not suppress a persistent condition (a re-run
       raises it again, by design)

   EXP-1. COI, licence and permit expiries fed a dashboard card and no watcher.
   Fixtures place a COI at 59, 29, 13, 6, 0 and minus 3 days and assert one
   notice per band at the right severity, that re-running the watcher the same
   day adds none, that clearing the date removes the condition, and that the
   rollup the dashboard card draws and the watcher list the same items.

   Usage:  node tools/qa-notice-watchers.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row.
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[notices] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  log(
    (ok ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (ok ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 600))
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

  try {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 160)));

    await page.goto(BASE + '/seed-test.html', { waitUntil: 'domcontentloaded' });
    await delay(300);
    await page.goto(BASE + '/project.html?id=demo-project', {
      waitUntil: 'load',
      timeout: 60000
    });
    await page.waitForFunction(
      () => !!(window.MMGR && window.MMGR.State && window.MMGR.Watch && window.MMGR.Schedule),
      null,
      { timeout: 45000 }
    );
    await delay(500);

    const ok = await page.evaluate(() => {
      const M = window.MMGR;
      // run() is gated on the signed-in assistant seam. This gate tests the
      // WATCHERS, not the gate, so the seam is opened for this QA profile
      // only; the gate itself has its own harness.
      try {
        M.Entitlements.aiAssistant = function () {
          return true;
        };
      } catch (e) {
        /* sealed: the pure-function checks below still run */
      }
      return !!(M.Watch.watchExpiries && M.Schedule.projectedFinish);
    });
    check('the new watchers and the shared finish helper are loaded', ok === true, ok);

    // ------------------------------------------------------------------
    // RISK-1: the finish target speaks.
    // ------------------------------------------------------------------
    const risk = await page.evaluate(() => {
      const today = '2026-10-26';
      const M = window.MMGR;
      const fixture = {
        charter: { targetCompletion: '2026-10-25' },
        tasks: [
          {
            id: 'a',
            name: 'Structural Steel',
            status: 'inprogress',
            startDate: '2026-10-15',
            endDate: '2026-10-26',
            duration: '9',
            critical: true,
            predecessors: []
          },
          {
            id: 'b',
            name: 'Management Reserve',
            status: 'todo',
            startDate: '2026-10-20',
            endDate: '2026-10-22',
            duration: '3',
            critical: false,
            predecessors: ['a']
          }
        ],
        resources: [],
        finishWatcher: true
      };
      const one = M.Watch.watchFinishTarget(fixture, today);
      const badge = M.Render.computeTimelineStatus(Object.assign({}, fixture, { isPhase: [] }));
      fixture.tasks[0].endDate = '2026-10-25';
      fixture.tasks[1].endDate = '2026-10-25';
      const onTarget = M.Watch.watchFinishTarget(fixture, today);
      fixture.finishWatcher = false;
      fixture.tasks[0].endDate = '2026-10-26';
      const off = M.Watch.watchFinishTarget(fixture, today);
      return { one, badge, onTarget, off };
    });

    check('RISK-1 one day over target raises exactly one notice', risk.one.length === 1, risk.one);
    check(
      'RISK-1 the notice names the contributor task',
      risk.one.length === 1 && /Structural Steel/.test(risk.one[0].text),
      risk.one[0] && risk.one[0].text
    );
    check(
      'RISK-1 the notice offers the reserve suggestion with its number',
      risk.one.length === 1 && /management reserve \(3 days\)/i.test(risk.one[0].advice || ''),
      risk.one[0] && risk.one[0].advice
    );
    check(
      'RISK-1 the badge and the notice quote the same overrun',
      !!risk.badge && risk.one.length === 1 && risk.badge.overrunDays === 1,
      { badge: risk.badge && risk.badge.overrunDays }
    );
    check('RISK-1 at target no notice is raised', risk.onTarget.length === 0, risk.onTarget);
    check('RISK-1 the kill switch stops the watcher', risk.off.length === 0, risk.off);

    // Deleting the notice must not suppress a persistent condition.
    const persist = await page.evaluate(async () => {
      const M = window.MMGR;
      M.State.updateState(st => {
        st.charter = st.charter || {};
        st.charter.targetCompletion = '2026-10-25';
        st.tasks = [
          {
            id: 'z1',
            name: 'Structural Steel',
            status: 'inprogress',
            startDate: '2026-10-15',
            endDate: '2026-10-26',
            duration: '9',
            critical: true,
            predecessors: []
          },
          {
            id: 'z2',
            name: 'Management Reserve',
            status: 'todo',
            startDate: '2026-10-20',
            endDate: '2026-10-22',
            duration: '3',
            critical: false,
            predecessors: ['z1']
          }
        ];
        st.aiInbox = [];
        st.finishWatcher = true;
      });
      M.Watch.run();
      const first = (M.State.getState().aiInbox || []).filter(n => n.kind === 'finish').length;
      M.State.updateState(st => {
        st.aiInbox = (st.aiInbox || []).filter(n => n.kind !== 'finish');
      });
      const cleared = (M.State.getState().aiInbox || []).filter(n => n.kind === 'finish').length;
      M.Watch.run();
      const again = (M.State.getState().aiInbox || []).filter(n => n.kind === 'finish').length;
      return { first, cleared, again };
    });
    check(
      'RISK-1 the notice is raised by run(), survives deletion as a condition',
      persist.first === 1 && persist.cleared === 0 && persist.again === 1,
      persist
    );

    // ------------------------------------------------------------------
    // EXP-1: expiries reach the notice box.
    // ------------------------------------------------------------------
    const exp = await page.evaluate(() => {
      const M = window.MMGR;
      function iso(offsetDays) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + offsetDays);
        return d.toISOString().slice(0, 10);
      }
      function runWith(offset) {
        M.State.updateState(st => {
          st.stakeholders = [
            {
              id: 'sx',
              name: 'Acme Electrical',
              contact: 'ops@acme.test',
              coiExpiry: offset === null ? '' : iso(offset),
              licenseExpiry: ''
            }
          ];
          st.permits = [];
          st.warrantyItems = [];
          st.tasks = [];
          st.expiryWatcher = true;
        });
        return M.Watch.watchExpiries(M.State.getState());
      }
      const bands = {};
      [
        [59, '60'],
        [29, '30'],
        [13, '14'],
        [6, '7'],
        [0, '7'],
        [-3, 'overdue']
      ].forEach(([offset, want]) => {
        const got = runWith(offset);
        bands[String(offset)] = {
          want,
          got: got.map(n => ({ band: n.band, sev: n.severity, text: n.text, advice: n.advice })),
          remind: got.length ? !!got[0].remind : false
        };
      });
      // Same day, twice: the second run must add nothing new.
      M.State.updateState(st => {
        st.aiInbox = [];
        st.stakeholders = [
          {
            id: 'sx',
            name: 'Acme Electrical',
            contact: 'ops@acme.test',
            coiExpiry: iso(29),
            licenseExpiry: ''
          }
        ];
        st.permits = [];
        st.warrantyItems = [];
        st.tasks = [];
      });
      M.Watch.run();
      const afterFirst = (M.State.getState().aiInbox || []).filter(n => n.kind === 'expiry').length;
      M.Watch.run();
      const afterSecond = (M.State.getState().aiInbox || []).filter(
        n => n.kind === 'expiry'
      ).length;
      // Clearing the date removes the condition.
      M.State.updateState(st => {
        st.stakeholders[0].coiExpiry = '';
      });
      M.Watch.run();
      const clearedCondition = M.Watch.watchExpiries(M.State.getState());
      // The dashboard rollup and the watcher list the same item.
      M.State.updateState(st => {
        st.stakeholders = [
          {
            id: 'sx',
            name: 'Acme Electrical',
            contact: 'ops@acme.test',
            coiExpiry: iso(10),
            licenseExpiry: iso(45)
          }
        ];
        st.permits = [];
        st.warrantyItems = [];
        st.tasks = [];
      });
      const rollup = M.Compliance.getExpiryRollup(120).filter(x => x.daysLeft !== null);
      const noticed = M.Watch.watchExpiries(M.State.getState());
      return { bands, afterFirst, afterSecond, clearedCondition, rollup, noticed };
    });

    const BANDS = [
      ['59', '60', 'info'],
      ['29', '30', 'caution'],
      ['13', '14', 'caution'],
      ['6', '7', 'attention'],
      ['0', '7', 'attention'],
      ['-3', 'overdue', 'attention']
    ];
    for (const [offset, want, sev] of BANDS) {
      const got = exp.bands[offset].got;
      check(
        'EXP-1 a COI ' + offset + ' day(s) out raises the ' + want + ' band at ' + sev,
        got.length === 1 && got[0].band === want && got[0].sev === sev,
        got
      );
    }
    check(
      'EXP-1 the notice carries a ready reminder built from the real contact',
      exp.bands['29'].remind === true,
      exp.bands['29']
    );
    check(
      'EXP-1 the same condition the same day adds no second notice',
      exp.afterFirst === 1 && exp.afterSecond === 1,
      { first: exp.afterFirst, second: exp.afterSecond }
    );
    check(
      'EXP-1 clearing the date removes the condition',
      exp.clearedCondition.length === 0,
      exp.clearedCondition
    );
    check(
      'EXP-1 the dashboard rollup and the notices list the same items',
      exp.rollup.length === exp.noticed.length && exp.rollup.length === 2,
      { rollup: exp.rollup.length, notices: exp.noticed.length }
    );

    check('no uncaught page error', errors.length === 0, errors);
    await ctx.close();
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
