/* ============================================================
   qa-team-collaboration.cjs - collaboration panel layout gate
   ------------------------------------------------------------
   T-24 (UI-IA-AND-MCP directive 2026-11-11, finding F1): a project
   name in the collaboration panel must render on ONE line. A skin
   that inherits a vertical writing-mode (or a row-flipped flex)
   used to stack the letters, so "Northgate Riverside" read as a
   vertical column.

   The fix lives in css/src/30-panels.css: `.team-project-name`
   uses white-space:nowrap + overflow:hidden + text-overflow:ellipsis,
   and `.team-project-row` forces writing-mode:horizontal-tb.

   This gate loads the REAL project page and the REAL served
   stylesheet, inserts the same markup js/cloud/team-ui.js renders,
   and measures the computed style and geometry at desktop and phone
   widths. It proves the rule is applied, not just present in source.

   Runs against the shared QA server (:8765 by default, MMGR_BASE to
   override). Usage: node tools/qa-team-collaboration.cjs
   Exit: 0 only when every check passes.
   ============================================================ */
'use strict';
const BASE = process.env.MMGR_BASE || 'http://127.0.0.1:8765';
const PID = 'qa-collab-layout';

let pass = 0;
let fail = 0;
const fails = [];
function ok(n) {
  pass++;
  console.log('  PASS', n);
}
function bad(n, d) {
  fail++;
  fails.push(n + ': ' + d);
  console.log('  FAIL', n, '-', d);
}

// The same two classes js/cloud/team-ui.js:753 emits for an owned project.
const HOST = `
  <div id="qa-collab-host" style="width:320px;max-width:100%">
    <div class="team-project-row">
      <span class="team-project-name">Northgate Riverside Mixed-Use Development Phase Two</span>
      <button type="button" class="btn btn-o btn-s">People</button>
    </div>
  </div>`;

async function measure(page) {
  return page.evaluate(() => {
    const host = document.getElementById('qa-collab-host');
    if (!host) {
      return { missing: true };
    }
    const row = host.querySelector('.team-project-row');
    const name = host.querySelector('.team-project-name');
    if (!row || !name) {
      return { missing: true, row: !!row, name: !!name };
    }
    const ncs = getComputedStyle(name);
    const rcs = getComputedStyle(row);
    const rect = name.getBoundingClientRect();
    const lineHeight = parseFloat(ncs.lineHeight) || parseFloat(ncs.fontSize) * 1.3;
    return {
      whiteSpace: ncs.whiteSpace,
      overflow: ncs.overflow,
      textOverflow: ncs.textOverflow,
      writingMode: rcs.writingMode,
      height: rect.height,
      lineHeight: lineHeight,
      scrollWidth: name.scrollWidth,
      clientWidth: name.clientWidth,
      rectWidth: rect.width,
      rowDisplay: rcs.display,
      rowDirection: rcs.flexDirection
    };
  });
}

function assertOneLine(tag, m) {
  if (m.missing) {
    bad(tag + ': markup', 'collaboration row/name not found');
    return;
  }
  if (m.whiteSpace === 'nowrap') {
    ok(tag + ': white-space is nowrap');
  } else {
    bad(tag + ': white-space is nowrap', m.whiteSpace);
  }
  if (m.overflow === 'hidden') {
    ok(tag + ': overflow is hidden');
  } else {
    bad(tag + ': overflow is hidden', m.overflow);
  }
  if (m.textOverflow === 'ellipsis') {
    ok(tag + ': text-overflow is ellipsis');
  } else {
    bad(tag + ': text-overflow is ellipsis', m.textOverflow);
  }
  if (m.writingMode === 'horizontal-tb') {
    ok(tag + ': row writing-mode is horizontal-tb');
  } else {
    bad(tag + ': row writing-mode is horizontal-tb', m.writingMode);
  }
  // A vertical letter stack is many line-heights tall. One line is
  // at most ~1.6x the line height (rounding + borders).
  if (m.height <= m.lineHeight * 1.6) {
    ok(tag + ': name renders on one line (' + m.height.toFixed(1) + 'px)');
  } else {
    bad(
      tag + ': name renders on one line',
      'height=' + m.height.toFixed(1) + ' lineHeight=' + m.lineHeight.toFixed(1)
    );
  }
  // The sample name is longer than the 320px host, so a correct
  // nowrap+ellipsis element overflows horizontally instead of wrapping.
  if (m.scrollWidth > m.clientWidth) {
    ok(tag + ': long name is clipped with ellipsis');
  } else {
    bad(
      tag + ': long name is clipped with ellipsis',
      'scrollWidth=' + m.scrollWidth + ' clientWidth=' + m.clientWidth
    );
  }
  if (m.rowDisplay === 'flex' && m.rowDirection === 'row') {
    ok(tag + ': row is a horizontal flex row');
  } else {
    bad(tag + ': row is a horizontal flex row', m.display + '/' + m.flexDirection);
  }
}

(async () => {
  let launchOpts = { headless: true };
  try {
    const cp = require('./chrome-launcher.cjs').chromePath;
    if (cp) {
      launchOpts.executablePath = cp;
    }
  } catch (e) {
    /* fall back to Playwright's bundled browser */
  }
  const { chromium } = require('playwright');
  const browser = await chromium.launch(launchOpts);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 896 } });
    await ctx.addInitScript(() => {
      try {
        const pid = 'qa-collab-layout';
        localStorage.setItem(
          'mmgr_admin_projects',
          JSON.stringify([
            {
              id: pid,
              title: 'QA Collab Layout',
              description: '',
              status: 'active',
              file: 'project.html?id=' + pid
            }
          ])
        );
        localStorage.setItem('mmgr_unlocked_' + pid, '1');
        localStorage.setItem(
          'mmgr_state_' + pid,
          JSON.stringify({
            projectName: 'QA Collab Layout',
            schemaVersion: 19,
            projectId: pid,
            tasks: []
          })
        );
      } catch (e) {
        /* storage unavailable */
      }
    });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e && e.message ? e.message : e)));
    await page.goto(BASE + '/project.html?id=' + PID, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    // Wait for the app shell, then insert the real collaboration markup.
    await page.waitForFunction(() => !!(window.MMGR && document.getElementById('db-ctrl')), {
      timeout: 30000
    });
    await page.evaluate(html => {
      const host = document.createElement('div');
      host.innerHTML = html;
      document.body.appendChild(host.firstElementChild);
    }, HOST);

    // Desktop
    assertOneLine('desktop', await measure(page));

    // Phone: the panel is width-capped, so the name must still be one line.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    assertOneLine('390px', await measure(page));

    if (pageErrors.length === 0) {
      ok('no page errors');
    } else {
      bad('no page errors', pageErrors.slice(0, 3).join(' | '));
    }
    await ctx.close();
  } finally {
    await browser.close();
  }

  console.log('\nQA-TEAM-COLLABORATION RESULT: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) {
    console.log('FAILURES:');
    fails.forEach(f => console.log('  - ' + f));
  }
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('HARNESS ERROR:', e && e.stack ? e.stack : e);
  process.exit(1);
});
