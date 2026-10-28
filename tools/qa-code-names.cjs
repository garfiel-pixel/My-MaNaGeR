#!/usr/bin/env node
/* ============================================================
   tools/qa-code-names.cjs - T-CODENAME gate (APP-3,
   REFINEMENT-DIRECTIVE-2026-10-24 section 7)
   ------------------------------------------------------------
   Three different things used to be called "a code". The directive
   fixes the words (Site admin code, Admin panel code, Project code
   and Client code), asks for one "Which code is this?" popover next
   to every code field, a backup status line in the admin header, and
   after "Restore access" on a new device a panel listing BOTH groups
   of projects (On this device, In your cloud).

   STATIC half:
     S1  no served page, js/ module or src/ module uses the bare words
         "admin code" outside one of the three names (HTML comments,
         block comments and line comments are stripped first, so an
         internal note is not a user-facing string)
     S2  the three names appear where the directive puts them
     S3  every code field carries a "Which code is this?" trigger and
         each of the three pages owns exactly one popover
     S4  the field guide carries the same story (locked rule 8)

   BROWSER half (serve.cjs + Playwright, real clicks only):
     B1  signed out, the admin header reads "Not backed up: sign in
         to back it up"
     B2  the trigger on the restore field opens the popover with all
         three names, Escape closes it
     B3  the launcher's "Have a code?" trigger opens the same popover
     B4  RESTORE E2E: a fresh profile, a signed-in signal, a typed
         Admin panel code, the real recovery modal, then the panel -
         where "What your code brought back" lists On this device
         (local registry) AND In your cloud (GET /api/cloud/projects,
         stubbed here so the arm needs no account), plus the plain
         sentence about what a code cannot restore
     B5  re-entering the panel does not show the recap again (flag is
         consumed), and the backup status line is still honest

   Usage:  node tools/qa-code-names.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row; wired in ci.yml T4.
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const log = s => process.stdout.write('[codenames] ' + s + '\n');
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

// ---- word scan -----------------------------------------------------------
function stripComments(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(line => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}
function bareAdminCodeHits(text) {
  const clean = stripComments(text);
  const hits = [];
  const re = /admin\s+code/gi;
  let m;
  while ((m = re.exec(clean))) {
    const before = clean.slice(Math.max(0, m.index - 8), m.index);
    if (/site\s+$/i.test(before)) {
      continue; // "site admin code" is a name
    }
    hits.push(clean.slice(Math.max(0, m.index - 40), m.index + 30).replace(/\s+/g, ' '));
  }
  return hits;
}

(async () => {
  let srv = null;
  try {
    const h = await fetch(BASE + '/admin.html');
    if (!h.ok) {
      throw new Error('not ok');
    }
  } catch (e) {
    log('starting serve.cjs for this run');
    srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 40; i++) {
      await delay(1000);
      try {
        const h = await fetch(BASE + '/admin.html');
        if (h.ok) {
          break;
        }
      } catch (err) {
        /* keep waiting */
      }
    }
  }

  const { chromium } = resolvePlaywright();
  let browser = null;
  try {
    // ---------- STATIC ----------
    const pages = [
      'admin.html',
      'app.html',
      'project.html',
      'contact.html',
      'calculator.html'
    ].filter(f => fs.existsSync(path.join(ROOT, f)));
    const jsFiles = fs
      .readdirSync(path.join(ROOT, 'js'))
      .filter(f => f.endsWith('.js'))
      .map(f => 'js/' + f);
    const srcFiles = ['src/admin.js', 'src/auth/admin-code.js'].filter(f =>
      fs.existsSync(path.join(ROOT, f))
    );
    let bad = [];
    pages.concat(jsFiles, srcFiles).forEach(rel => {
      const hits = bareAdminCodeHits(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
      hits.forEach(h => bad.push(rel + ': ' + h));
    });
    check('S1 no bare "admin code" outside the three names', bad.length === 0, bad.slice(0, 6));

    const adminHtml = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
    const appHtml = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
    const projHtml = fs.readFileSync(path.join(ROOT, 'project.html'), 'utf8');
    check(
      'S2a admin.html names the Site admin code field',
      /<label[^>]*>Site admin code<\/label>/.test(adminHtml)
    );
    check(
      'S2b admin.html names the Admin panel code restore field',
      /Admin panel code<\/label>/.test(adminHtml) && /Enter my Admin panel code/.test(adminHtml)
    );
    check(
      'S2c all three pages carry the Project code and Client code row',
      [adminHtml, appHtml, projHtml].every(s => s.indexOf('Project code and Client code') > -1)
    );

    const trig = s => (s.match(/class="code-which" popovertarget="which-code-pop"/g) || []).length;
    check(
      'S3a admin.html has two triggers (restore + site admin)',
      trig(adminHtml) === 2,
      trig(adminHtml)
    );
    check(
      'S3b app.html has two triggers (Have a code + access modal)',
      trig(appHtml) === 2,
      trig(appHtml)
    );
    const cloudJs = fs.readFileSync(path.join(ROOT, 'js', 'mmgr-cloud.js'), 'utf8');
    check(
      'S3c the project Cloud Backup code box has a trigger',
      trig(cloudJs) === 1,
      trig(cloudJs)
    );
    check(
      'S3d each page owns exactly one popover element',
      [adminHtml, appHtml, projHtml].every(
        s => (s.match(/id="which-code-pop"[^>]*popover/g) || []).length === 1
      )
    );

    const guide = fs.readFileSync(path.join(ROOT, 'mymanager-field-guide.html'), 'utf8');
    check(
      'S4 field guide carries the three names and the restore story',
      guide.indexOf('Which code is this?') > -1 &&
        guide.indexOf('Site admin code') > -1 &&
        guide.indexOf('Admin panel code') > -1 &&
        guide.indexOf('Project code and Client code') > -1 &&
        guide.indexOf('On this device') > -1 &&
        guide.indexOf('In your cloud') > -1
    );

    // ---------- BROWSER ----------
    // Use the system Chrome (chrome-launcher.cjs), never Playwright's own
    // bundled chromium: CI installs the playwright devDep with
    // --ignore-scripts and has no browser download step (see ci.yml "T4:
    // Install test deps"), so chromium.launch() with no executablePath
    // fails there with "Executable doesn't exist" while passing locally.
    let chromePath;
    try {
      chromePath = require('./chrome-launcher.cjs').chromePath || undefined;
    } catch (e) {}
    if (chromePath && !path.isAbsolute(chromePath)) {
      try {
        chromePath =
          require('child_process')
            .execSync((process.platform === 'win32' ? 'where' : 'command -v') + ' ' + chromePath, {
              stdio: ['ignore', 'pipe', 'ignore']
            })
            .toString()
            .trim()
            .split(/\r?\n/)[0] || undefined;
      } catch (e) {
        chromePath = undefined;
      }
    }
    if (chromePath && !fs.existsSync(chromePath)) chromePath = undefined;
    browser = await chromium.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });

    const openPopover = async (page, selector) => {
      await page.waitForSelector(selector, { timeout: 8000 });
      await page.click(selector);
      await delay(250);
      return page.evaluate(() => {
        const el = document.getElementById('which-code-pop');
        if (!el) {
          return { open: false, dts: [] };
        }
        let open = false;
        try {
          open = el.matches(':popover-open');
        } catch (e) {
          open = el.hasAttribute('popover') && getComputedStyle(el).display !== 'none';
        }
        return {
          open,
          dts: Array.from(el.querySelectorAll('dt')).map(d => d.textContent.trim())
        };
      });
    };

    // The restore block only shows once the page has seen signed-in evidence.
    // Boot re-runs setupRestoreVisibility() with NO event while the session
    // probe settles, which re-hides it, so keep sending the signal until the
    // field is actually on screen.
    const revealRestore = async page => {
      let visible = false;
      for (let i = 0; i < 12 && !visible; i++) {
        await page.evaluate(() => {
          document.dispatchEvent(
            new CustomEvent('mmgr:user-changed', { detail: { signedIn: true } })
          );
        });
        await delay(400);
        visible = await page.evaluate(() => {
          const el = document.getElementById('setup-restore');
          return !!el && !el.hidden;
        });
      }
      return visible;
    };

    // B1 + B2 on admin.html
    {
      const page = await browser.newPage();
      await page.goto(BASE + '/admin.html', { waitUntil: 'domcontentloaded' });
      await delay(700);
      const status = await page.evaluate(() => {
        const el = document.getElementById('escrow-status');
        return el ? el.textContent.trim() : null;
      });
      check(
        'B1 signed out, the header says not backed up',
        status === 'Not backed up: sign in to back it up',
        status
      );

      const revealed = await revealRestore(page);
      check(
        'B2a1 the restore field is on screen before its trigger is pressed',
        revealed,
        revealed
      );
      const pop = await openPopover(page, '#setup-restore .code-which');
      check('B2a the restore field opens the popover', pop.open, pop);
      check(
        'B2b the popover names all three codes',
        pop.dts.join('|') === 'Site admin code|Admin panel code|Project code and Client code',
        pop.dts
      );
      await page.keyboard.press('Escape');
      await delay(200);
      const closed = await page.evaluate(() => {
        try {
          return !document.getElementById('which-code-pop').matches(':popover-open');
        } catch (e) {
          return true;
        }
      });
      check('B2c Escape closes the popover', closed);
      await page.close();
    }

    // B3 on app.html
    {
      const page = await browser.newPage();
      await page.goto(BASE + '/app.html', { waitUntil: 'domcontentloaded' });
      await delay(900);
      const pop = await openPopover(page, '#code-entry .code-which');
      check('B3a the launcher code field opens the popover', pop.open, pop);
      check('B3b it carries the same three names', pop.dts.length === 3, pop.dts);
      await page.keyboard.press('Escape');
      await delay(150);
      await page.close();
    }

    // B4 + B5: restore on a fresh profile
    {
      const page = await browser.newPage();
      await page.route('**/api/cloud/projects', route =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            projects: [
              {
                projectId: 'c-1',
                label: 'Oldmeadow Clinic',
                accessRole: 'owner',
                hasSnapshot: true
              },
              {
                projectId: 'c-2',
                label: 'Kingsway Bridge',
                accessRole: 'editor',
                hasSnapshot: false
              }
            ]
          })
        })
      );
      await page.route('**/api/auth/admin-code', route =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, hasCode: false })
        })
      );
      await page.addInitScript(() => {
        try {
          localStorage.setItem(
            'mmgr_admin_projects',
            JSON.stringify([{ id: 'p-1', title: 'Harbour View School', isDemo: false }])
          );
        } catch (e) {}
      });
      await page.goto(BASE + '/admin.html', { waitUntil: 'domcontentloaded' });
      await delay(800); // signed-in evidence reveals the restore field (the real listener path)
      const visible = await revealRestore(page);
      check('B4a the signed-in restore field appears', visible);

      await page.fill('#setup-restore-code', 'MY-PANEL-CODE-123');
      await page.click('#setup-restore [data-action="restoreAdminCode"]');
      await page.waitForSelector('#rc-om.show', { timeout: 8000 }).catch(() => {});
      const rcShown = await page.evaluate(() => {
        const el = document.getElementById('rc-om');
        return !!el && el.classList.contains('show');
      });
      check('B4b Restore access hands over the recovery code modal', rcShown);

      await page.check('#rc-saved-cb');
      await delay(100);
      await page.click('#rc-done');
      await page.waitForSelector('#restore-recap:not([hidden])', { timeout: 8000 }).catch(() => {});
      const recap = await page.evaluate(() => {
        const card = document.getElementById('restore-recap');
        if (!card || card.hidden) {
          return { shown: false };
        }
        return {
          shown: true,
          heads: Array.from(card.querySelectorAll('h4')).map(h => h.textContent.trim()),
          local: (document.getElementById('rr-local') || {}).textContent || '',
          cloud: (document.getElementById('rr-cloud') || {}).textContent || '',
          note: (card.querySelector('.hint') || {}).textContent || ''
        };
      });
      check('B4c the panel opens with What your code brought back', recap.shown, recap);
      check(
        'B4d it lists both groups',
        (recap.heads || []).join('|') === 'On this device|In your cloud',
        recap.heads
      );
      check(
        'B4e the device group lists the local project',
        /Harbour View School/.test(recap.local || ''),
        recap.local
      );
      check(
        'B4f the cloud group lists the account projects from GET /api/cloud/projects',
        /Oldmeadow Clinic/.test(recap.cloud || '') && /Kingsway Bridge/.test(recap.cloud || ''),
        recap.cloud
      );
      check(
        'B4g it says plainly what a code cannot restore',
        /not copied here unless they were linked to the cloud/.test(recap.note || ''),
        recap.note
      );

      const status2 = await page.evaluate(() => {
        const el = document.getElementById('escrow-status');
        return el ? el.textContent.trim() : null;
      });
      check('B5a the header status line survives inside the panel', !!status2, status2);

      // panel session persists: reload, the recap flag is consumed
      await page.reload({ waitUntil: 'domcontentloaded' });
      await delay(900);
      const again = await page.evaluate(() => {
        const el = document.getElementById('restore-recap');
        return el ? !el.hidden : null;
      });
      check('B5b the recap is shown once, not on every entry', again === false, again);

      const pop2 = await openPopover(page, '#cloud-admin-section .code-which').catch(() => null);
      check(
        'B5c the site admin code field inside the panel opens the popover',
        !!(pop2 && pop2.open),
        pop2
      );
      await page.close();
    }
  } catch (e) {
    check('harness ran to completion', false, String(e && e.stack ? e.stack : e).slice(0, 500));
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (srv) {
      try {
        srv.kill();
      } catch (e) {}
    }
  }

  const failed = results.filter(r => !r.ok);
  log('---');
  log('qa-code-names: ' + (results.length - failed.length) + '/' + results.length + ' checks');
  process.exit(failed.length ? 1 : 0);
})();
