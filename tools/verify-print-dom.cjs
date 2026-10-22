#!/usr/bin/env node
/* ============================================================
   tools/verify-print-dom.cjs - T4 (AUDIT-DIRECTIVE-2026-10-18, rule N4)
   ------------------------------------------------------------
   "A CSS selector that depends on DOM nesting is tested against the real DOM."

   This is the exact bug class that blanked the printed estimate (C5): the print
   sheet hid every direct child of .bcp-main and then re-showed
   `.bcp-main > .bcp-result`, but the estimate card is a GRANDCHILD
   (main > .bcp-grid > .bcp-result). The rule matched nothing, the page printed
   blank, and every static gate stayed green because the selector was never
   resolved against the parsed document.

   What this gate does, against a REAL parser (Chromium) and the REAL CSSOM:
     1. loads calculator.html, injects css/mmgr.css as a stylesheet
     2. enumerates every rule whose selector mentions body.print-estimate and
        that SHOWS something (display:block/flex or visibility:visible) and
        requires each one to match at least one element
     3. applies print media + body.print-estimate and requires the estimate
        card (.bcp-result) to be actually displayed, with no hidden ancestor and
        non-empty rendered text
     4. flags a hide-all-children rule (`> *`) whose kept child sits deeper than
        a direct child without a matching show rule (the C5 shape)

   Exit 0 = the print sheet survives the real DOM, 1 = it does not.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'calculator.html');
const CSS = path.join(ROOT, 'css', 'mmgr.css');

function resolvePlaywright() {
  try {
    return require('playwright');
  } catch (e) {
    const helper = path.join(ROOT, 'tools', 'chrome-launcher.cjs');
    if (fs.existsSync(helper)) {
      const h = require(helper);
      if (h && h.chromium) return h;
    }
    throw new Error('playwright is required for verify-print-dom.cjs: ' + e.message);
  }
}

// ---- S-6.3: the vector sheet's printable box, measured from the writer ----
// The PDF writer keeps its own geometry (js/mmgr-pdf.js, `layout`), and the
// print sheet's @page margins are the same measurement. This gate reads both:
// no text box may leave the printable box on ANY sheet, the repeated header
// band must sit entirely above the body, and every table row must be drawn
// exactly once across the pages (a break that swallows a row is silent data
// loss). It also fails when the two surfaces disagree about the paper edge.
function pdfBoxProblems(problems, css) {
  const EPS = 0.05;
  let Pdf;
  try {
    const win = {};
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, 'js', 'mmgr-pdf.js'), 'utf8'),
      vm.createContext({ window: win, console: console }),
      { filename: 'js/mmgr-pdf.js' }
    );
    Pdf = win.MMGR && win.MMGR.Pdf;
  } catch (e) {
    problems.push('js/mmgr-pdf.js could not be loaded: ' + ((e && e.message) || e));
    return;
  }
  if (!Pdf || typeof Pdf.build !== 'function') {
    problems.push('js/mmgr-pdf.js no longer exports MMGR.Pdf.build');
    return;
  }

  // One measurement, two surfaces: the print sheet's own @page block.
  const pageRule = /@page\s*\{[^}]*?margin:\s*([^;]+);/i.exec(css);
  if (!pageRule) {
    problems.push('css/mmgr.css has no @page margin block - the printable box is undefined');
  } else {
    const mm = pageRule[1]
      .trim()
      .split(/\s+/)
      .map(v => parseFloat(v));
    const side =
      mm.length === 1 ? mm[0] : mm.length === 3 ? mm[1] : mm.length === 2 ? mm[0] : mm[3];
    const top = mm[0];
    const bottom = mm.length >= 3 ? mm[2] : mm[0];
    const want = Pdf.PRINT_BOX && Pdf.PRINT_BOX.marginMm;
    if (typeof want !== 'number') {
      problems.push('js/mmgr-pdf.js no longer exports PRINT_BOX.marginMm');
    } else {
      if (Math.abs(side - want) > 0.01) {
        problems.push(
          'the print sheet and the PDF writer disagree about the side margin: @page ' +
            side +
            'mm vs PRINT_BOX ' +
            want +
            'mm'
        );
      }
      if (top < want || bottom < want) {
        problems.push(
          'the @page top/bottom margin (' +
            top +
            'mm/' +
            bottom +
            'mm) is smaller than PRINT_BOX ' +
            want +
            'mm - the browser header/footer strip would land on the content'
        );
      }
    }
  }

  // A table-shaped draw list that MUST paginate at both sheet sizes.
  const W = 1600,
    H = 2400,
    hdrPx = 150;
  const prims = [{ type: 'rect', x: 0, y: 0, w: W, h: hdrPx, fill: '#eeeeee' }];
  prims.push({
    type: 'text',
    x: 20,
    y: 30,
    str: 'Project schedule',
    size: 18,
    weight: 700,
    fill: '#000000'
  });
  ['WBS', 'Task', 'Start', 'Finish', 'Total'].forEach((h, i) =>
    prims.push({ type: 'text', x: 40 + i * 240, y: 100, str: h, size: 11, fill: '#333333' })
  );
  const ROWS = 90;
  for (let i = 0; i < ROWS; i++) {
    const y = hdrPx + 20 + i * 24;
    prims.push({ type: 'rect', x: 0, y: y - 12, w: W, h: 22, fill: i % 2 ? '#ffffff' : '#f7f7f7' });
    prims.push({ type: 'text', x: 20, y: y, str: 'Row ' + (i + 1), size: 11, fill: '#111111' });
    prims.push({
      type: 'text',
      x: W - 20,
      y: y,
      str: 'JMD 1,234,567.89',
      size: 11,
      align: 'right',
      fill: '#111111'
    });
    // A bold, wide line in the same cell: the case the old width estimator
    // under-measured, so right-aligned text ran past the paper edge.
    prims.push({
      type: 'text',
      x: W - 20,
      y: y + 2,
      str: 'SUPERVISOR ALLOWANCE - wmw',
      size: 11,
      weight: 700,
      align: 'right',
      fill: '#111111'
    });
  }

  for (const mode of ['a4', 'a3']) {
    const res = Pdf.build(prims, { page: mode, W: W, H: H, hdrPx: hdrPx });
    if (!res.layout || !res.layout.length) {
      problems.push(mode + ': the PDF writer returned no page geometry to check');
      continue;
    }
    if (res.pages !== res.layout.length) {
      problems.push(mode + ': page count (' + res.pages + ') does not match the layout');
    }
    const drawn = {};
    res.layout.forEach((pg, pi) => {
      const label = mode + ' sheet ' + (pi + 1) + '/' + res.layout.length;
      let body = 0;
      pg.texts.forEach(t => {
        if (t.x < pg.box.x0 - EPS || t.x + t.w > pg.box.x1 + EPS) {
          problems.push(
            label +
              ': text leaves the printable box horizontally: "' +
              t.str +
              '" x=' +
              t.x.toFixed(1) +
              ' right=' +
              (t.x + t.w).toFixed(1) +
              ' box=[' +
              pg.box.x0.toFixed(1) +
              ',' +
              pg.box.x1.toFixed(1) +
              ']'
          );
        }
        const top = t.y - t.size * 0.72;
        const bottom = t.y + t.size * 0.24;
        if (top < pg.box.y0 - EPS || bottom > pg.box.y1 + EPS) {
          problems.push(
            label +
              ': text leaves the printable box vertically: "' +
              t.str +
              '" top=' +
              top.toFixed(1) +
              ' bottom=' +
              bottom.toFixed(1) +
              ' box=[' +
              pg.box.y0.toFixed(1) +
              ',' +
              pg.box.y1.toFixed(1) +
              ']'
          );
        }
        if (t.band === 'body') {
          body++;
          if (/^Row \d+$/.test(t.str)) {
            drawn[t.str] = (drawn[t.str] || 0) + 1;
          }
        }
      });
      if (!body) {
        problems.push(label + ': the sheet carries no body rows (blank page)');
      }
      const header = pg.texts.filter(t => t.band === 'header');
      if (!header.length) {
        problems.push(label + ': the repeated header band is missing');
      } else {
        const headerBottom = Math.min.apply(
          null,
          header.map(t => t.y)
        );
        const bodyTops = pg.texts.filter(t => t.band === 'body').map(t => t.y - t.size * 0.72);
        const bodyTop = Math.max.apply(null, bodyTops);
        if (headerBottom - bodyTop < 1) {
          problems.push(
            label +
              ': the header band overlaps the first row (header bottom ' +
              headerBottom.toFixed(1) +
              'pt, body top ' +
              bodyTop.toFixed(1) +
              'pt)'
          );
        }
      }
    });
    for (let i = 1; i <= ROWS; i++) {
      const n = drawn['Row ' + i] || 0;
      if (n !== 1) {
        problems.push(mode + ': row ' + i + ' was drawn ' + n + ' times (must be exactly 1)');
        break;
      }
    }
    console.log(
      '[verify-print-dom] ' +
        mode +
        ' vector sheet: ' +
        res.pages +
        ' page(s), ' +
        Object.keys(drawn).length +
        '/' +
        ROWS +
        ' rows once, all text inside the box'
    );
  }
}

// ---- OWNER 2026-10-22: the star field must never reach paper --------------
// With performance mode off the Premium Glass engine mounts a full-viewport
// position:fixed #glass-canvas (WebGL starfield) plus its cursor glow. A fixed
// box is anchored to the PAGE box, so Chromium repeated it on every printed
// sheet and Print / PDF exported with the deep-space background instead of
// white paper. The print sheet must hide both. This arm is static (it needs no
// server) and cannot pass vacuously: it also requires js/mmgr-glass.js to still
// mount those exact ids, so a renamed canvas cannot quietly escape the rule.
// The live proof (engine active, print media emulated in Chromium) is gate G13
// in qa-glass.cjs.
function printBackdropProblems(problems, css) {
  const glass = fs.readFileSync(path.join(ROOT, 'js', 'mmgr-glass.js'), 'utf8');
  const mounts = glass.indexOf("'glass-canvas'") > -1;
  const glow = glass.indexOf("'mouse-glow'") > -1;
  if (!mounts || !glow) {
    problems.push(
      'js/mmgr-glass.js no longer mounts ' +
        (mounts ? '' : '#glass-canvas ') +
        (glow ? '' : '.mouse-glow') +
        ' - this gate and the print sheet would be silencing the wrong thing'
    );
  }
  // Comments are stripped first: prose inside the print block NAMES these
  // ids, and a checker that reads its own explanation as evidence passes while
  // the rule is gone (measured - renaming the rule while the comment stood
  // still turned this arm green).
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const hit = sel => {
    // a print rule that hides this selector somewhere in the stylesheet
    const re = new RegExp(
      '@media print\\s*\\{[\\s\\S]*?' +
        sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        '[^{}]*\\{[^}]*display:\\s*none',
      'i'
    );
    return re.test(bare);
  };
  ['#glass-canvas', '.mouse-glow'].forEach(sel => {
    if (!hit(sel)) {
      problems.push(
        'the starfield is not hidden for paper: css/mmgr.css has no @media print rule making ' +
          sel +
          ' display:none (it prints on every sheet)'
      );
    }
  });
}

function chromeExecutable() {
  try {
    const h = require(path.join(ROOT, 'tools', 'chrome-launcher.cjs'));
    return h.chromePath || undefined;
  } catch (e) {
    return undefined;
  }
}

(async function main() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const css = fs.readFileSync(CSS, 'utf8');
  const { chromium } = resolvePlaywright();

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromeExecutable(),
    args: ['--disk-cache-size=0', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const problems = [];

  try {
    // Only the markup matters: block every network request (the page's own
    // scripts are irrelevant here and would 404 against about:blank).
    await page.route('**/*', route => route.abort());

    // Strip the page's own <script> tags so nothing repaints the DOM under the
    // measurement, then load it: Chromium parses it (a real HTML parser).
    const markupOnly = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    await page.setContent(markupOnly, { waitUntil: 'domcontentloaded' });

    // Inject the real stylesheet through a <style> node so its relative asset
    // URLs never need to resolve, then read it back through the CSSOM.
    await page.addStyleTag({ content: css });
    await page.evaluate(() => document.body.classList.add('print-estimate'));

    // ---- 1 + 4: enumerate print rules through the browser's own CSS parser ----
    const report = await page.evaluate(() => {
      const out = { show: [], hideAll: [], unparsable: [] };
      function walkCssRules(rules) {
        for (const rule of rules) {
          // @media / @supports / @layer carry nested rules and no selector;
          // a style rule carries selectorText (and an EMPTY nested list, which
          // is why the nested branch is tested after the selector).
          if (typeof rule.selectorText !== 'string') {
            if (rule.cssRules && rule.cssRules.length) {
              walkCssRules(rule.cssRules);
            }
            continue;
          }
          const sel = rule.selectorText || '';
          if (!sel || sel.indexOf('body.print-estimate') === -1) continue;
          const style = rule.style || {};
          const disp = style.display || '';
          const vis = style.visibility || '';
          const parts = sel.split(',').map(s => s.trim());
          for (const part of parts) {
            if (
              !part.indexOf('body.print-estimate') === 0 &&
              part.indexOf('body.print-estimate') === -1
            )
              continue;
            const isShow = disp === 'block' || disp === 'flex' || vis === 'visible';
            // `> *`, `> *:not(...)`, `> *[hidden]`: any hide rule aimed at ALL
            // children of a node is the shape that hid the estimate card.
            const isHideAllChildren = disp === 'none' && /(^|[\s>])\*(\s|:|\[|,|$)/.test(part);
            let count = null;
            try {
              count = document.querySelectorAll(part).length;
            } catch (e) {
              out.unparsable.push(part);
            }
            if (isShow) out.show.push({ selector: part, count: count });
            if (isHideAllChildren) out.hideAll.push({ selector: part, count: count });
          }
        }
      }
      for (const sheet of document.styleSheets) {
        try {
          walkCssRules(sheet.cssRules);
        } catch (e) {
          /* cross-origin sheet: none here */
        }
      }
      return out;
    });

    if (!report.show.length) {
      problems.push(
        'no body.print-estimate show rule was found at all - the print sheet seems to be gone'
      );
    }
    for (const s of report.show) {
      if (s.count === 0) {
        problems.push('show selector matches NOTHING in calculator.html: ' + s.selector);
      }
    }
    for (const h of report.hideAll) {
      if (h.count === 0) {
        problems.push('hide-all-children rule matches nothing: ' + h.selector);
      }
    }

    // ---- 3: print media on, the estimate card must actually be visible ----
    await page.emulateMedia({ media: 'print' });
    const visible = await page.evaluate(() => {
      const card = document.querySelector('.bcp-result');
      if (!card) return { ok: false, why: '.bcp-result is not in the document' };
      let node = card;
      const chain = [];
      while (node && node !== document.documentElement) {
        const cs = getComputedStyle(node);
        chain.push({
          node:
            node.tagName.toLowerCase() +
            (node.className ? '.' + String(node.className).split(' ')[0] : ''),
          display: cs.display,
          visibility: cs.visibility
        });
        node = node.parentElement;
      }
      const hidden = chain.filter(c => c.display === 'none' || c.visibility === 'hidden');
      const text = card.innerText || card.textContent || '';
      return {
        ok: hidden.length === 0 && card.getBoundingClientRect().height > 0,
        hidden: hidden,
        height: Math.round(card.getBoundingClientRect().height),
        text: text.slice(0, 120),
        empty: !text.trim()
      };
    });
    if (!visible.ok) {
      problems.push(
        'the estimate card is NOT printable: ' +
          JSON.stringify({ hiddenAncestors: visible.hidden, height: visible.height })
      );
    }
    if (visible.empty) {
      problems.push('the printable estimate card carries no text');
    }

    // ---- S-6.3: CHROME BLEED + RIGHT-COLUMN CLIPPING ----------------------
    // A position:fixed box is anchored to the PAGE box, so Chromium repeats it
    // on EVERY printed sheet: the tour spotlight's 9999px shadow spread dimmed
    // all four paper edges and the tour popover painted over the first rows.
    // The card is also measured at three widths, because a right column that
    // overflows its cell is silently clipped by the page edge.
    const bleed = { fixed: [], over: [] };
    for (const w of [360, 768, 1280]) {
      await page.setViewportSize({ width: w, height: 900 });
      const r = await page.evaluate(() => {
        // Give the card one realistic long-money row so a narrow sheet has
        // something that COULD overflow; the page's own scripts never ran.
        const outEl = document.getElementById('calc-output');
        if (outEl && !outEl.querySelector('.calc-line')) {
          outEl.innerHTML =
            '<div class="calc-line"><span>Labor statutory costs (NIS, NHT, HEART, Education) 5%</span><strong>JMD 12,345,678.90</strong></div>' +
            '<div class="calc-line calc-line-total"><span>Estimated total</span><strong>JMD 12,345,678.90</strong></div>';
        }
        const fixed = [];
        document.querySelectorAll('body *').forEach(el => {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') return;
          if (cs.position === 'fixed' || cs.position === 'sticky') {
            fixed.push(
              el.tagName.toLowerCase() +
                (el.className ? '.' + String(el.className).split(' ')[0] : '') +
                ' (' +
                cs.position +
                ')'
            );
          }
        });
        const over = [];
        document.querySelectorAll('.bcp-result, .bcp-result *').forEach(el => {
          if (el.scrollWidth - el.clientWidth > 1) {
            over.push(
              el.tagName.toLowerCase() +
                (el.className ? '.' + String(el.className).split(' ')[0] : '') +
                ' scrollWidth=' +
                el.scrollWidth +
                ' clientWidth=' +
                el.clientWidth
            );
          }
        });
        const head = document.querySelector('.bcp-quote-head');
        const firstRow = document.querySelector('.calc-line');
        const gap =
          head && firstRow
            ? Math.round(firstRow.getBoundingClientRect().top - head.getBoundingClientRect().bottom)
            : null;
        return { fixed: fixed, over: over, gap: gap };
      });
      if (r.fixed.length) {
        bleed.fixed.push(w + 'px: ' + r.fixed.join(', '));
      }
      if (r.over.length) {
        bleed.over.push(w + 'px: ' + r.over.join(' | '));
      }
      if (r.gap !== null && r.gap < 8) {
        bleed.over.push(w + 'px: first row sits ' + r.gap + 'px under the letterhead');
      }
    }
    if (bleed.fixed.length) {
      problems.push(
        'screen chrome is marked fixed/sticky under print media (it repeats on every sheet at the page edge): ' +
          bleed.fixed.join('; ')
      );
    }
    if (bleed.over.length) {
      problems.push('the printed estimate overflows its cell: ' + bleed.over.join('; '));
    }

    console.log('[verify-print-dom] calculator.html + css/mmgr.css parsed for real');
    console.log('[verify-print-dom] show rules resolved: ' + report.show.length);
    report.show.forEach(s =>
      console.log('    matches ' + String(s.count).padStart(3) + '  ' + s.selector)
    );
    console.log('[verify-print-dom] hide-all-children rules: ' + report.hideAll.length);
    report.hideAll.forEach(h =>
      console.log('    matches ' + String(h.count).padStart(3) + '  ' + h.selector)
    );
    console.log('[verify-print-dom] printable estimate card height: ' + visible.height + 'px');
    console.log('[verify-print-dom] printable text starts: ' + JSON.stringify(visible.text));
    if (report.unparsable.length) {
      console.log(
        '[verify-print-dom] selectors Chromium refused (informational): ' +
          report.unparsable.join(' | ')
      );
    }
    console.log(
      '[verify-print-dom] print chrome bleed: ' +
        (bleed.fixed.length ? 'FAIL' : 'none fixed/sticky') +
        ', horizontal overflow: ' +
        (bleed.over.length ? 'FAIL' : 'none at 360/768/1280')
    );
  } finally {
    await browser.close();
  }

  // ---- S-6.3: THE VECTOR SHEET'S PRINTABLE BOX ---------------------------
  // The PDF writer (js/mmgr-pdf.js) is the shared surface for the Gantt, the
  // estimate and the PO. Its own geometry is checked here, at A4 and A3, on
  // the first AND the last sheet: every text box inside the printable box,
  // the repeated header band entirely above the body, and every row drawn
  // exactly once (a page break that drops a row is a silent data loss).
  pdfBoxProblems(problems, css);
  printBackdropProblems(problems, css);

  if (problems.length) {
    console.error('\n[verify-print-dom] FAIL (' + problems.length + '):');
    problems.forEach(p => console.error('    ' + p));
    process.exit(1);
  }
  console.log(
    '[verify-print-dom] PASS: the print allow-list matches the real DOM and the printed box\n'
  );
})().catch(e => {
  console.error('[verify-print-dom] HARNESS ERROR: ' + ((e && e.stack) || e));
  process.exit(1);
});
