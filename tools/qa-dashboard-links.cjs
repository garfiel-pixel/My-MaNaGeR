/* ============================================================
   tools/qa-dashboard-links.cjs - every dashboard number is a door
   ------------------------------------------------------------
   UX-2026-11-19 B5. The dashboard used to state facts and stop:
   "7 overdue" was a number, not a way to the seven tasks. Every
   row that stands for records is now a link through ONE helper
   (MMGR.Nav.go), which switches the panel, applies the view
   filter, scrolls the record into view and flashes it - and the
   back gesture returns to the dashboard where it was left.

   Gates:
     N1 the dashboard carries the full inventory (>= 14 links).
     N2 every [data-nav] element lands on its panel.
     N3 a filtered link shows the banner and only matching rows.
     N4 a record link flashes the record it names.
     N5 a column link flashes the Kanban column.
     N6 an anchor link flashes the card that is its destination.
     N7 back returns to the dashboard with its scroll restored.
     N8 a record that no longer exists shows a one-line notice.
     N9 view-only mode navigates exactly the same way.
     N10 a sidebar switch is a history entry too (back leaves the panel).

   Usage:   node tools/qa-dashboard-links.cjs
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
const log = s => process.stdout.write('[qa-links] ' + s + '\n');
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

const FLUSH_RAF = `new Promise(function (res) {
  requestAnimationFrame(function () { requestAnimationFrame(function () { res(1); }); });
})`;

// A project that lights up every row of the inventory: an overdue task, a
// blocked one, one due inside three days, a completed one, a live issue, a
// risk, a person whose COI expires, a budget line and a weather delay that
// names two tasks. Dates are relative to the day the harness runs.
const SEED = `(function () {
  function iso(offsetDays) {
    var d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }
  MMGR.State.updateState(function (s) {
    s.tasks = [
      { id: 'T1', name: 'Overdue slab', status: 'todo', startDate: iso(-30), endDate: iso(-6) },
      { id: 'T2', name: 'Blocked rebar', status: 'blocked', startDate: iso(-10), endDate: iso(9) },
      { id: 'T3', name: 'Due soon paint', status: 'inprogress', startDate: iso(-2), endDate: iso(2) },
      { id: 'T4', name: 'Done footing', status: 'completed', startDate: iso(-20), endDate: iso(-12) },
      { id: 'T5', name: 'Carryover framing', status: 'todo', startDate: iso(-40), endDate: iso(-20) }
    ];
    s.issues = [
      { id: 'I1', description: 'Water ingress at level 2', owner: 'Site', targetDate: iso(5), status: 'open' }
    ];
    s.risks = [
      {
        id: 'R1',
        description: 'Hurricane delay',
        probability: 'High',
        impact: 'High',
        mitigation: 'Buffer',
        linkedTaskId: '',
        costImpactEstimate: 5000,
        issueId: null
      }
    ];
    s.stakeholders = [
      { id: 'S1', name: 'Acme Concrete', role: 'Sub', coiExpiry: iso(10), licenseExpiry: '' }
    ];
    s.budgetLines = [{ id: 'B1', name: 'Concrete', planned: 1000, actual: 1500 }];
    s.weatherLog = [{ date: iso(-3), condition: 'Rain 30mm', note: '', affectedTaskIds: ['T1', 'T2'] }];
    s.baseline = {
      capturedAt: new Date().toISOString(),
      tasks: [
        { id: 'T1', name: 'Overdue slab', endDate: iso(-12) },
        { id: 'T2', name: 'Blocked rebar', endDate: iso(4) }
      ],
      budgetLines: [{ id: 'B1', planned: 900 }]
    };
  });
  MMGR.Render.renderAll();
})()`;

// What each filter must show, computed independently of the app's own
// predicate: the harness states the spec, not a copy of the implementation.
const EXPECT = `(function () {
  var s = MMGR.State.getState();
  var now = new Date();
  var wkStart = new Date(now);
  wkStart.setDate(now.getDate() - now.getDay());
  wkStart.setHours(0, 0, 0, 0);
  var wkEnd = new Date(wkStart);
  wkEnd.setDate(wkStart.getDate() + 7);
  function overdue(t) {
    return t.status !== 'completed' && t.endDate && new Date(t.endDate) < new Date(new Date().toDateString());
  }
  function soon(t) {
    if (t.status === 'completed' || !t.endDate) { return false; }
    var d = new Date(t.endDate);
    var diff = (d - new Date(new Date().toDateString())) / 86400000;
    return diff >= 0 && diff <= 3;
  }
  var out = {};
  out.overdue = s.tasks.filter(overdue).map(function (t) { return String(t.id); });
  out.atrisk = s.tasks.filter(soon).map(function (t) { return String(t.id); });
  out.blocked = s.tasks.filter(function (t) { return t.status === 'blocked'; }).map(function (t) { return String(t.id); });
  out.done = s.tasks.filter(function (t) { return t.status === 'completed'; }).map(function (t) { return String(t.id); });
  out.inprogress = s.tasks.filter(function (t) { return t.status === 'inprogress'; }).map(function (t) { return String(t.id); });
  out['week-planned'] = s.tasks.filter(function (t) {
    if (t.status === 'completed' || !t.endDate) { return false; }
    var d = new Date(t.endDate);
    return d >= wkStart && d < wkEnd;
  }).map(function (t) { return String(t.id); });
  out['week-done'] = s.tasks.filter(function (t) {
    if (t.status !== 'completed' || !t.endDate) { return false; }
    var d = new Date(t.endDate);
    return d >= wkStart && d < wkEnd;
  }).map(function (t) { return String(t.id); });
  out.carryover = s.tasks.filter(function (t) {
    return t.status !== 'completed' && t.endDate && new Date(t.endDate) < wkStart;
  }).map(function (t) { return String(t.id); });
  out['ids:T1,T2'] = ['T1', 'T2'];
  return out;
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

    async function openProject(opts) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await ctx.addInitScript(`try {
        localStorage.setItem('mmgr_unlocked_demo-project', '1');
        ${
          opts && opts.readonly
            ? "localStorage.setItem('mmgr_scope_demo-project', 'readonly');"
            : ''
        }
      } catch (e) {}`);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(BASE + '/project.html?id=demo-project', { waitUntil: 'domcontentloaded' });
      await delay(1400);
      await page.evaluate(SEED);
      await page.evaluate(FLUSH_RAF);
      await delay(400);
      return { ctx, page, errors };
    }

    const activePanel = page =>
      page.evaluate(() => {
        const el = document.querySelector('.panel.active');
        return el ? el.id.replace(/^panel-/, '') : '';
      });

    const links = page =>
      page.evaluate(() => {
        const root = document.getElementById('panel-dash');
        if (!root) {
          return [];
        }
        return Array.from(root.querySelectorAll('[data-nav]')).map(function (el) {
          return {
            panel:
              el.getAttribute('data-nav-panel') ||
              (el.getAttribute('href') || '').replace(/^#/, ''),
            id: el.getAttribute('data-nav-id') || '',
            filter: el.getAttribute('data-nav-filter') || '',
            col: el.getAttribute('data-nav-col') || '',
            anchor: el.getAttribute('data-nav-anchor') || '',
            text: (el.textContent || '').trim().slice(0, 60)
          };
        });
      });

    // ---- N1/N2/N3/N4/N5/N6: every link does what it promises ----------
    {
      const { ctx, page, errors } = await openProject();
      const expect = await page.evaluate(EXPECT);
      const all = await links(page);
      check('N1 the dashboard carries the full link inventory', all.length >= 14, {
        count: all.length,
        labels: all.map(l => l.text)
      });
      check(
        'N1 every link names a panel',
        all.every(l => !!l.panel),
        all.filter(l => !l.panel)
      );

      const failures = [];
      for (let i = 0; i < all.length; i++) {
        const l = all[i];
        // Fresh dashboard for every link, so one failure cannot cascade.
        if ((await activePanel(page)) !== 'dash') {
          await page.evaluate(() => window.MMGR.Nav.go({ panel: 'dash' }));
          await delay(250);
        }
        await page.evaluate(i => {
          // A flash from the previous link is still fading; clear it so a
          // stale hit can never stand in for the one being tested.
          document.querySelectorAll('.ag-hit').forEach(function (el) {
            el.classList.remove('ag-hit');
          });
          const root = document.getElementById('panel-dash');
          const els = root.querySelectorAll('[data-nav]');
          if (els[i]) {
            els[i].click();
          }
        }, i);
        await delay(320);
        const st = await page.evaluate(
          ({ id, filter, col, anchor }) => {
            const panel = document.querySelector('.panel.active');
            const pid = panel ? panel.id.replace(/^panel-/, '') : '';
            const bar = document.getElementById('wbs-view-bar');
            const rows = Array.from(document.querySelectorAll('#wbs-body tr[data-id]')).map(
              function (r) {
                return r.getAttribute('data-id');
              }
            );
            const hit = Array.from(document.querySelectorAll('.ag-hit')).map(function (el) {
              return el.getAttribute('data-id') || el.getAttribute('data-idx') || el.id || '';
            });
            return {
              panel: pid,
              bar: !!bar && !bar.hidden ? bar.textContent.trim() : '',
              rows: rows,
              hit: hit,
              colHit:
                !!document.querySelector('[data-drop-status="' + col + '"].ag-hit') ||
                !!document.querySelector('#col-' + col + '.ag-hit'),
              anchorHit: !!document.querySelector('[data-nav-anchor="' + anchor + '"].ag-hit')
            };
          },
          { id: l.id, filter: l.filter, col: l.col, anchor: l.anchor }
        );
        if (st.panel !== l.panel) {
          failures.push({ text: l.text, want: l.panel, got: st.panel });
          continue;
        }
        if (l.filter) {
          const want = (expect[l.filter] || []).slice().sort().join(',');
          const got = st.rows.slice().sort().join(',');
          if (!st.bar) {
            failures.push({ text: l.text, why: 'no filter banner' });
          } else if (want !== got) {
            failures.push({ text: l.text, filter: l.filter, want: want, got: got });
          }
        }
        if (l.id && st.hit.indexOf(l.id) === -1) {
          failures.push({ text: l.text, why: 'record not flashed', want: l.id, hit: st.hit });
        }
        if (l.col && !st.colHit) {
          failures.push({ text: l.text, why: 'column not flashed', col: l.col });
        }
        if (l.anchor && !st.anchorHit) {
          failures.push({ text: l.text, why: 'anchor not flashed', anchor: l.anchor });
        }
      }
      check('N2 every link lands on its panel with its target', failures.length === 0, failures);
      check('N2 no page error while following every link', errors.length === 0, errors);
      await ctx.close();
    }

    // ---- N7: the back gesture -------------------------------------
    {
      const { ctx, page } = await openProject();
      // Scroll the dashboard so the restore is measurable.
      await page.evaluate(() => window.scrollTo(0, 420));
      await delay(150);
      const before = await page.evaluate(() => window.scrollY);
      const clicked = await page.evaluate(() => {
        const a = document.querySelector('#panel-dash [data-nav-filter="overdue"]');
        if (!a) {
          return false;
        }
        a.click();
        return true;
      });
      await delay(400);
      const onWbs = await activePanel(page);
      await page.goBack();
      await delay(500);
      const after = await page.evaluate(() => ({
        panel: (document.querySelector('.panel.active') || {}).id,
        y: window.scrollY
      }));
      check('N7 the link really left the dashboard', clicked && onWbs === 'wbs', {
        clicked: clicked,
        onWbs: onWbs
      });
      check(
        'N7 back returns to the dashboard with its scroll restored',
        after.panel === 'panel-dash' && Math.abs(after.y - before) <= 8,
        { before: before, after: after }
      );
      await ctx.close();
    }

    // ---- N8: a record that no longer exists ------------------------
    {
      const { ctx, page } = await openProject();
      await page.evaluate(() => {
        window.MMGR.Nav.go({ panel: 'wbs', recordId: 'T-GONE' });
      });
      await delay(450);
      const st = await page.evaluate(() => {
        const miss = document.querySelector('#panel-wbs .nav-miss');
        return {
          panel: (document.querySelector('.panel.active') || {}).id,
          miss: miss ? miss.textContent.trim() : '',
          rows: document.querySelectorAll('#wbs-body tr[data-id]').length
        };
      });
      check(
        'N8 a missing record shows a one-line notice, not a blank panel',
        st.panel === 'panel-wbs' && /no longer in this project/i.test(st.miss) && st.rows > 0,
        st
      );
      await ctx.close();
    }

    // ---- N9: view-only mode ----------------------------------------
    {
      const { ctx, page } = await openProject({ readonly: true });
      const readonly = await page.evaluate(() => window.MMGR.App.isReadonly());
      const clicked = await page.evaluate(() => {
        const a = document.querySelector('#panel-dash [data-nav-filter="blocked"]');
        if (!a) {
          return false;
        }
        a.click();
        return true;
      });
      await delay(400);
      const st = await page.evaluate(() => ({
        panel: (document.querySelector('.panel.active') || {}).id,
        bar:
          !!document.getElementById('wbs-view-bar') &&
          !document.getElementById('wbs-view-bar').hidden
      }));
      check(
        'N9 view-only mode navigates the same way',
        readonly && clicked && st.panel === 'panel-wbs' && st.bar,
        { readonly: readonly, clicked: clicked, st: st }
      );
      await ctx.close();
    }

    // ---- N10: a sidebar switch is a history entry -------------------
    {
      const { ctx, page } = await openProject();
      const clicked = await page.evaluate(() => {
        const b = document.querySelector('.sec-btn[data-section="bud"]');
        if (!b) {
          return false;
        }
        b.click();
        return true;
      });
      await delay(350);
      const onBud = await activePanel(page);
      await page.goBack();
      await delay(450);
      const back = await activePanel(page);
      check(
        'N10 a sidebar switch is a history entry too',
        clicked && onBud === 'bud' && back === 'dash',
        { clicked: clicked, onBud: onBud, back: back }
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
