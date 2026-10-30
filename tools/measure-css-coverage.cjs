#!/usr/bin/env node
/* tools/measure-css-coverage.cjs - E6.1: how much of each stylesheet is dead?
   --------------------------------------------------------------------------
   Read-only. It edits nothing, deletes nothing and builds nothing.

   WHY NOT THE DEVTOOLS COVERAGE API: `CSS.startRuleUsageTracking` reported 319
   rules for a stylesheet that carries 3,139 blocks, so its totals are not a
   denominator you can quote. This script measures the same question in a way
   that can be checked by hand instead:

     1. Collect every class token, id and tag name that actually appears, in
        two places: the served pages (the DOM, after the app has rendered) and
        the JavaScript that toggles classes at runtime. Both count as "someone
        uses this".
     2. Walk every rule in the source stylesheet and read the class/id tokens
        of its LAST compound selector (the part that decides the match).
     3. Report a rule as DEFINITELY DEAD only when none of its tokens appears in
        either place. A rule whose token only appears in JS is "state" - live,
        just not visible at load.

   What this cannot see: a class that is built by string concatenation, an
   attribute-only selector, a token injected from a template. The number is a
   floor, which is exactly what a deletion pass should start from - and every
   deletion is still proven by `verify-css-integrity` (every source rule must
   survive into dist) plus the visual gates.

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
const PAGES = ['project.html', 'calculator.html', 'app.html', 'admin.html', 'index.html'];
const list = process.argv.includes('--list');

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
      /(?:classList\.(?:add|remove|toggle|contains)|className\s*=|class=)[^\n]{0,200}/g
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

async function domTokens(browser) {
  const classes = new Set();
  const ids = new Set();
  const tags = new Set();
  for (const name of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + '/' + name, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(2200);
    } catch (e) {
      await ctx.close();
      continue;
    }
    const got = await page.evaluate(() => {
      const cl = new Set();
      const id = new Set();
      const tg = new Set();
      document.querySelectorAll('*').forEach(el => {
        el.classList.forEach(c => cl.add(c));
        if (el.id) {
          id.add(el.id);
        }
        tg.add(el.tagName.toLowerCase());
      });
      return { cl: [...cl], id: [...id], tg: [...tg] };
    });
    got.cl.forEach(c => classes.add(c));
    got.id.forEach(i => ids.add(i));
    got.tg.forEach(t => tags.add(t));
    await ctx.close();
  }
  return { classes, ids, tags };
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
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disk-cache-size=0'] });
  const dom = await domTokens(browser);
  await browser.close();
  const js = jsTokens();

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
        const { classes, ids } = keyTokens(p);
        if (!classes.length && !ids.length) {
          continue; // element/attribute/pseudo selectors are not measured here
        }
        checked++;
        const inDom = ids.some(t => dom.ids.has(t)) || classes.some(t => dom.classes.has(t));
        const inJs = ids.some(t => js.has(t)) || classes.some(t => js.has(t));
        if (!inDom && !inJs) {
          dead++;
          deadSelectors.push(p.replace(/\s+/g, ' ').slice(0, 120));
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

  console.log('CSS DEAD-RULE MEASUREMENT (class/id selectors, DOM + JS as evidence)\n');
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
    '\n  "dead" = no class/id token of the selector appears in any of the five' +
      '\n  served pages after render, and none appears anywhere in js/. A floor,' +
      '\n  not a ceiling: a token built by concatenation is invisible here.'
  );
  if (list) {
    for (const [f, d] of Object.entries(deadList)) {
      console.log('\n' + f + ' dead candidates (' + d.length + '):');
      d.slice(0, 80).forEach(s => console.log('   ' + s));
    }
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
