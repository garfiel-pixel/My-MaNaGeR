#!/usr/bin/env node
/* tools/measure-css-coverage.cjs - E6.1: how much of each stylesheet is dead?
   --------------------------------------------------------------------------
   Read-only. It edits nothing, deletes nothing and builds nothing.

   WHY NOT THE DEVTOOLS COVERAGE API: `CSS.startRuleUsageTracking` reported 319
   rules for a stylesheet that carries 3,139 blocks, so its totals are not a
   denominator you can quote. This script measures the same question in a way
   that can be checked by hand instead:

     1. Collect every class token and id that actually appears, in two places:
        the served pages (the DOM, after the app has rendered) and the
        JavaScript that toggles classes at runtime. Both count as "someone
        uses this".
     2. Walk every rule in the source stylesheet and read the class/id tokens
        of its LAST compound selector (the part that decides the match).
     3. Report a rule as DEFINITELY DEAD only when none of its tokens appears in
        either place. A rule whose token only appears in JS is "state" - live,
        just not visible at load.

   CORRECTION 2026-10-30 - the first version of this tool under-measured badly,
   and the fix is the whole point of the numbers below. It loaded
   `project.html` with no project id, so the page gate-redirected to
   `app.html?locked=default` and the ENTIRE project workspace contributed zero
   evidence; it measured only `index.html` out of the 13 pages that link
   `marketing.css`; and its `page.goto` failure was swallowed by
   `catch { continue }`, so a page that never rendered looked like 100% dead
   CSS. It reported 31.7% (mmgr) and 28.9% (marketing). With the workspace
   unlocked, every marketing page measured and every page failure reported, the
   same rules measure 11.7% and 9.7%.

   Two consequences, both deliberate:
     - Every page that fails to load, and every page that lands somewhere other
       than the URL asked for, is printed and turns the exit code non-zero. A
       measurement that quietly skips a page is worse than no measurement.
     - `--list` prints every candidate, not the first 80 per file.

   What this still cannot see: a class built by string concatenation, an
   attribute-only selector, a token injected from a template, and any state
   reached only by clicking (modals, drawers, tabs) unless the page renders it
   at load. The number is a floor, which is exactly what a deletion pass should
   start from - and every deletion is still proven by `verify-css-integrity`
   (every source rule must survive into dist) plus the visual gates.

   Usage:  node tools/measure-css-coverage.cjs [--list]
   Needs:  playwright, and a served site (QA_BASE, default :8765).
   Registry: docs/CI-TEST-COVERAGE.md -> MANUAL (a measurement, not a gate).
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const ROOT = path.resolve(__dirname, '..');
const list = process.argv.includes('--list');

/* The app pages. `project.html` is the workspace and it is behind a project
   gate: with no id it 307s to `app.html?locked=...`, so it is opened through
   the same unlock the QA battery uses (seed the demo project, set the scope,
   then load it) instead of being added to this list. */
const APP_PAGES = ['calculator.html', 'app.html', 'admin.html'];

/** Every root page that actually links a marketing stylesheet. */
function marketingPages() {
  return fs
    .readdirSync(ROOT)
    .filter(f => /\.html$/.test(f))
    .filter(f => /marketing(?:\.min)?\.css/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
    .sort();
}

/** Every class/id attribute value the JS in js/ can produce. */
function jsTokens() {
  const out = new Set();
  const dirs = ['js', 'js/cloud', 'js/app', 'src'];
  const files = [];
  for (const d of dirs) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) {
      continue;
    }
    for (const f of fs.readdirSync(abs)) {
      if (/\.(js|mjs)$/.test(f)) {
        files.push(path.join(abs, f));
      }
    }
  }
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    // classList.add/remove/toggle('x'), className = 'a b', class="x" in templates
    for (const m of src.matchAll(
      /(?:classList\.(?:add|remove|toggle|contains)|className\s*=|class=)[^\n]{0,400}/g
    )) {
      for (const t of m[0].matchAll(/['"`]([A-Za-z_][\w -]*?)['"`]/g)) {
        t[1].split(/\s+/).forEach(c => c && out.add(c));
      }
    }
    // any bare string that looks like a class token used with querySelector
    for (const m of src.matchAll(/querySelector(?:All)?\(\s*['"`]([^'"`]+)['"`]/g)) {
      for (const t of m[1].matchAll(/[.#]([A-Za-z_][\w-]*)/g)) {
        out.add(t[1]);
      }
    }
  }
  return out;
}

/** Harvest the tokens one rendered page contributes. */
async function harvest(page) {
  return page.evaluate(() => {
    const classes = new Set();
    const ids = new Set();
    document.querySelectorAll('*').forEach(el => {
      el.classList.forEach(c => classes.add(c));
      if (el.id) {
        ids.add(el.id);
      }
    });
    return { classes: [...classes], ids: [...ids] };
  });
}

/** Load one page, and record loudly if it never rendered or landed elsewhere. */
async function measureUrl(browser, url, classes, ids, problems) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(BASE + '/' + url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(2000);
    const want = '/' + url.split('?')[0];
    const landed = new URL(page.url()).pathname;
    if (landed !== want) {
      problems.push(
        url +
          ' REDIRECTED to ' +
          landed +
          new URL(page.url()).search +
          ' (its surface was NOT measured)'
      );
      await ctx.close();
      return false;
    }
    const got = await harvest(page);
    got.classes.forEach(c => classes.add(c));
    got.ids.forEach(i => ids.add(i));
    await ctx.close();
    return true;
  } catch (e) {
    problems.push(url + ' FAILED TO LOAD: ' + String(e).slice(0, 100));
    await ctx.close();
    return false;
  }
}

/** The project workspace, unlocked the way the QA battery unlocks it. */
async function measureProjectWorkspace(browser, classes, ids, problems) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const url = 'project.html?id=demo-project';
  try {
    await page.goto(BASE + '/seed-test.html', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1200);
    await page.goto(BASE + '/app.html', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      try {
        localStorage.setItem('mmgr_scope_demo-project', 'full');
      } catch (e) {
        /* private mode: the gate will redirect and we report it */
      }
    });
    await page.goto(BASE + '/' + url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(2500);
    const landed = new URL(page.url()).pathname + new URL(page.url()).search;
    if (landed !== '/' + url) {
      problems.push(
        url + ' REDIRECTED to ' + landed + ' (the whole project workspace was NOT measured)'
      );
      await ctx.close();
      return false;
    }
    const got = await harvest(page);
    got.classes.forEach(c => classes.add(c));
    got.ids.forEach(i => ids.add(i));
    await ctx.close();
    return true;
  } catch (e) {
    problems.push(url + ' FAILED TO LOAD: ' + String(e).slice(0, 100));
    await ctx.close();
    return false;
  }
}

/** The tokens that decide whether a selector can match: classes + ids. */
function keyTokens(selector) {
  const last = selector.split(/\s*[>+~]\s*|\s+(?![^[]*\])/).pop() || selector;
  const classes = [...last.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(m => m[1]);
  const ids = [...last.matchAll(/#([A-Za-z_][\w-]*)/g)].map(m => m[1]);
  return { classes, ids };
}

/** Split a stylesheet into top-level rules (handles nested at-rules). */
function rules(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1) {
      break;
    }
    const selector = src.slice(i, open).trim();
    // find the matching close brace
    let depth = 0;
    let j = open;
    for (; j < src.length; j++) {
      if (src[j] === '{') {
        depth++;
      } else if (src[j] === '}') {
        depth--;
        if (depth === 0) {
          break;
        }
      }
    }
    out.push({ selector, body: src.slice(open + 1, j) });
    i = j + 1;
  }
  return out;
}

(async () => {
  const files = ['css/mmgr.css', 'css/marketing.css'].filter(f =>
    fs.existsSync(path.join(ROOT, f))
  );
  const marketing = marketingPages();
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disk-cache-size=0'] });
  const classes = new Set();
  const ids = new Set();
  const problems = [];

  const workspaceOk = await measureProjectWorkspace(browser, classes, ids, problems);
  let loaded = 0;
  for (const name of [...APP_PAGES, ...marketing]) {
    if (await measureUrl(browser, name, classes, ids, problems)) {
      loaded++;
    }
  }
  await browser.close();
  const js = jsTokens();

  console.log('CSS DEAD-RULE MEASUREMENT (class/id selectors, DOM + JS as evidence)\n');
  console.log(
    '  pages measured: ' +
      loaded +
      ' + ' +
      (workspaceOk ? 'the project workspace' : 'NO WORKSPACE') +
      '  |  ' +
      marketing.length +
      ' of them link a marketing stylesheet'
  );
  console.log(
    '  evidence: ' + classes.size + ' classes, ' + ids.size + ' ids, ' + js.size + ' JS tokens\n'
  );

  const rows = [];
  const deadList = {};
  for (const f of files) {
    // Comments must go BEFORE parsing: a comment between rules otherwise
    // becomes part of the next selector and turns into a fake "dead" hit.
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const all = rules(src);
    const seen = new Set();
    let checked = 0;
    let dead = 0;
    const deadSelectors = [];
    for (const r of all) {
      // skip at-rules that wrap other rules; their inner rules are visited by
      // the brace scan on the next pass, and their own selector has no tokens
      if (!r.selector || r.selector.startsWith('@')) {
        continue;
      }
      const parts = r.selector
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      for (const p of parts) {
        const key = p.replace(/\s+/g, ' ');
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        const { classes: cls, ids: idn } = keyTokens(p);
        if (!cls.length && !idn.length) {
          continue; // element/attribute/pseudo selectors are not measured here
        }
        checked++;
        const inDom = idn.some(t => ids.has(t)) || cls.some(t => classes.has(t));
        const inJs = idn.some(t => js.has(t)) || cls.some(t => js.has(t));
        if (!inDom && !inJs) {
          dead++;
          deadSelectors.push(p.replace(/\s+/g, ' ').slice(0, 160));
        }
      }
    }
    rows.push({
      file: f,
      checked,
      dead,
      pct: checked ? Math.round((dead / checked) * 1000) / 10 : 0
    });
    deadList[f] = deadSelectors;
  }

  console.log('  file                 selectors   dead   share');
  for (const r of rows) {
    console.log(
      '  ' +
        r.file.padEnd(22) +
        String(r.checked).padStart(8) +
        String(r.dead).padStart(7) +
        (r.pct + '%').padStart(9)
    );
  }
  console.log(
    '\n  "dead" = no class/id token of the selector appears in any measured page' +
      '\n  after render, and none appears anywhere in js/. A floor, not a ceiling:' +
      '\n  a token built by concatenation, or a state only reached by clicking,' +
      '\n  is invisible here.'
  );
  if (list) {
    for (const [f, d] of Object.entries(deadList)) {
      console.log('\n' + f + ' dead candidates (' + d.length + '):');
      d.forEach(s => console.log('   ' + s));
    }
  }
  if (problems.length) {
    console.error('\nMEASUREMENT INCOMPLETE - fix these before trusting the numbers:');
    problems.forEach(p => console.error('  ' + p));
    process.exitCode = 1;
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
