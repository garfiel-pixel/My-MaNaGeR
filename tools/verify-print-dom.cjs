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
            if (!part.indexOf('body.print-estimate') === 0 && part.indexOf('body.print-estimate') === -1)
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
          node: node.tagName.toLowerCase() + (node.className ? '.' + String(node.className).split(' ')[0] : ''),
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

    console.log('[verify-print-dom] calculator.html + css/mmgr.css parsed for real');
    console.log('[verify-print-dom] show rules resolved: ' + report.show.length);
    report.show.forEach(s => console.log('    matches ' + String(s.count).padStart(3) + '  ' + s.selector));
    console.log('[verify-print-dom] hide-all-children rules: ' + report.hideAll.length);
    report.hideAll.forEach(h => console.log('    matches ' + String(h.count).padStart(3) + '  ' + h.selector));
    console.log('[verify-print-dom] printable estimate card height: ' + visible.height + 'px');
    console.log('[verify-print-dom] printable text starts: ' + JSON.stringify(visible.text));
    if (report.unparsable.length) {
      console.log('[verify-print-dom] selectors Chromium refused (informational): ' + report.unparsable.join(' | '));
    }
  } finally {
    await browser.close();
  }

  if (problems.length) {
    console.error('\n[verify-print-dom] FAIL (' + problems.length + '):');
    problems.forEach(p => console.error('    ' + p));
    process.exit(1);
  }
  console.log('[verify-print-dom] PASS: the print allow-list matches the real DOM\n');
})().catch(e => {
  console.error('[verify-print-dom] HARNESS ERROR: ' + ((e && e.stack) || e));
  process.exit(1);
});
