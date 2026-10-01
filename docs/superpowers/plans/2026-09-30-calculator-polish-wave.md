# Build Cost Calculator Polish Wave — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Load `no-slacking` + `verification-before-completion` first; load `universal-ui-architect` before touching UI.

**Goal:** Implement the owner-approved spec `docs/superpowers/specs/2026-09-30-calculator-polish-wave-design.md`: app-style top bar, back/forward-cache sprite icon-restore bug fix, how-to guide slider, research-backed work items (linear/each/roofing-square bases), document type + title on exports, first-visit spotlight tutorial, mobile pass.

**Architecture:** The calculator stays standalone (`calculator.html` + `js/calculator-page.js`, no bundle, no inline scripts — CSP hashes never move). The bug fix is a new tiny IIFE `js/mmgr-icon-restore.js` appended to BOTH bundles in `build.js` plus a plain script tag on calculator.html. All styling is token-only additions to the `bcp-` block in `css/mmgr.css` (rebuild via `node build.js`). Every wave: build → verify → targeted harness → Conventional Commit (no AI footers).

**Tech Stack:** Vanilla JS (IIFE on `window.MMGR`/`window.MMGRIconRestore`), token-only CSS, localStorage flags, existing Playwright harness pattern (`tools/qa-calc-playwright-audit.cjs`), no new dependencies.

## Global Constraints (every task inherits)

- **No inline scripts** in calculator.html — external files only, CSP `INLINE_SCRIPT_HASHES` and serve.cjs mirror stay untouched. If any inline block ever changes, regenerate hashes (worker.js header command) — plan avoids this entirely.
- **Cache-busting:** calculator.html does NOT register the service worker; its assets ride 1-year immutable HTTP cache. Every change to `dist/mmgr.min.css` or `js/calculator-page.js` MUST bump `?v=` in calculator.html (currently css `?v=9`, js `?v=9` → both go to `?v=10` in Wave 2; the new module tag ships at `?v=10`).
- **Rebuild after any source change:** `node build.js` (bundles + minified CSS). Editing `js/calculator-page.js` alone needs no bundle rebuild; CSS changes do.
- **No emoji** on served pages; icons are sprite symbols only (`css/mmgr-icons.svg#i-...`). New icons must be added as symbols; prose names buttons, never draws glyphs.
- **Token-only colors** — no hex literals; both themes must hold; reduced-motion safe for any animation.
- **Offline-first sacred:** no new network calls anywhere in this plan.
- **Harness contracts:** `.calc-empty`, `.calc-line*`, `.calc-sum*`, `.calc-hist*`, `.bcp-est-row`, `.bcp-sheet-row` must keep working — `tools/qa-calculator-page.cjs` asserts them (69 gates today).
- **Verification per wave:** `node build.js` → `npm run verify` → `node tools/qa-calculator-page.cjs` → `node tools/qa-calc-playwright-audit.cjs` (Playwright harness starts its own serve.cjs on :8765; kill nothing by image name — lesson 1).
- **sw.js shell bump** at the end (v338 → v339) with version-narrative comment (repo style: prepend `// v339: ...` narrative into the CACHE line comment).
- Conventional Commits ≤72 chars subject, imperative mood, detail in body, **no AI attribution footers** (owner hard gate).
- Windows/bash: stage scratch in `tmp/` only (gitignored); never `/tmp`.

## File Structure

| File | Responsibility |
|---|---|
| `js/mmgr-icon-restore.js` (new) | bfcache `pageshow(persisted)` sprite re-resolution; exposes `MMGRIconRestore.restore()` for tests |
| `build.js` | Append the new module to `APP_MODULES` + `APP_LAUNCHER_MODULES` |
| `calculator.html` | Top bar markup (Wave 2), guide card (Wave 3), new select options (Wave 4), doc type/title fields (Wave 5), tutorial nudge card (Wave 6), `?v=` bumps |
| `js/calculator-page.js` | Guide slider logic, new WORK entries + basis labels, doc-type/title in readState/CSV/print, tutorial engine |
| `css/mmgr.css` | `.bcp-top` bar redesign, guide slider, tutorial overlay/popover, sticky-Calculate mobile rules |
| `tools/qa-calculator-page.cjs` | New static+browser gates per wave |
| `tools/qa-calc-playwright-audit.cjs` | New IR (icon-restore) + mobile gates |
| `docs/CI-TEST-COVERAGE.md` | Registry row updates (gate counts) |
| `sw.js`, `PLANNING-TODO-2026-09-03.txt` | Shell bump + session record (final wave) |

---

### Task 1 (Wave 1): bfcache sprite icon-restore bug fix

**Files:**
- Create: `js/mmgr-icon-restore.js`
- Modify: `build.js` (both module lists), `tools/qa-calc-playwright-audit.cjs`, `docs/CI-TEST-COVERAGE.md`

**Interfaces:**
- Produces: `window.MMGRIconRestore.restore()` (idempotent, no-arg, safe on any page), auto-wired on `pageshow` with `event.persisted === true`. No namespace coupling, no load-order dependency.

- [ ] **Step 1: Write the module** — `js/mmgr-icon-restore.js`:

```javascript
/* ============================================================
   My MaNaGeR - Sprite icon restore after bfcache restores
   ------------------------------------------------------------
   Owner-reported bug (2026-09-30): app.html -> calculator.html
   -> Back leaves app icons unpainted. Proven by probe (probe
   in session notes): the return navigation restores from
   Chrome's back/forward cache (pageshow.persisted === true),
   and on such restores <use href="css/mmgr-icons.svg#i-...">
   references lose their rendered shadow content - the svg
   hosts keep their CSS size but draw nothing.
   Fix: on a persisted pageshow, force every external-sprite
   <use> to re-resolve its reference (clear href, reflow,
   restore). Idempotent, offline-first (touches no network),
   no inline scripts anywhere.
   Exposes MMGRIconRestore.restore() so harnesses can exercise
   the path directly.
   ============================================================ */
(function() {
'use strict';

function restore() {
  var uses = document.querySelectorAll('use');
  for (var i = 0; i < uses.length; i++) {
    try {
      var u = uses[i];
      var href = u.getAttribute('href') || u.getAttribute('xlink:href');
      if (!href || href.charAt(0) === '#') continue; // in-document refs are safe
      u.removeAttribute('href');
      if (u.hasAttribute('xlink:href')) u.removeAttribute('xlink:href');
      void u.getBoundingClientRect(); // force style/blur invalidation
      u.setAttribute('href', href);
      if (u.getAttribute('xlink:href') !== href && href.indexOf('xlink') === -1) {
        // restore legacy attribute too when the document declares it
        u.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', href);
      }
    } catch (e) { /* fail-soft per node; never block the page */ }
  }
}

window.addEventListener('pageshow', function(ev) {
  if (ev && ev.persisted) restore();
});

window.MMGRIconRestore = { restore: restore };
})();
```

- [ ] **Step 2: Register in build.js** — append to the END of `APP_MODULES` (after `js/mmgr-templates.js`) and the END of `APP_LAUNCHER_MODULES` (after `js/mmgr-glass.js`), each with the comment:

```javascript
  // bfcache sprite restore (2026-09-30): icons vanish after Back when
  // Chrome restores the page from the back/forward cache; load-order
  // independent, DOM-only, so it sits last.
  'js/mmgr-icon-restore.js',
```

- [ ] **Step 3: Rebuild + smoke** — `node build.js`, then confirm the module landed in both bundles:

```bash
node build.js
grep -c "MMGRIconRestore" dist/bundle.js dist/app-bundle.js
```
Expected: `>= 1` in each file.

- [ ] **Step 4: Add the Playwright gate** — in `tools/qa-calc-playwright-audit.cjs`, add a new section after the MOBILE section (before the summary), following the file's existing `check()` style:

```javascript
    // ============ IR: icon restore after bfcache-style restore ============
    // Owner bug 2026-09-30: after a back/forward-cache restore the external
    // sprite <use> refs lose their paint. We cannot force real bfcache in
    // CI, so we verify the CONTRACT: a synthetic persisted pageshow must
    // re-resolve every external-sprite reference on both pages.
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(BASE + '/calculator.html', { waitUntil: 'networkidle' });
      const c1 = await page.evaluate(() => {
        if (!window.MMGRIconRestore || !MMGRIconRestore.restore) return { err: 'module missing on calculator' };
        const u = document.querySelector('svg.ico use[href^="css/mmgr-icons.svg"]');
        if (!u) return { err: 'no external sprite use found' };
        u.removeAttribute('href');           // simulate the lost reference
        MMGRIconRestore.restore();
        return { ok: !!u.getAttribute('href') };
      });
      check('IR1 calculator: restore() re-resolves a dropped sprite href', c1.ok === true, c1);
      // app.html: same contract through the bundle build
      await page.goto(BASE + '/app.html', { waitUntil: 'networkidle' });
      const c2 = await page.evaluate(() => {
        if (!window.MMGRIconRestore) return { err: 'module missing on app (bundle)' };
        const uses = Array.from(document.querySelectorAll('use[href^="css/mmgr-icons.svg"]'));
        if (!uses.length) return { err: 'no external sprite uses' };
        uses.forEach(u => u.removeAttribute('href'));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        return { ok: uses.every(u => !!u.getAttribute('href')), n: uses.length };
      });
      check('IR2 app: persisted pageshow restores all dropped sprite hrefs', c2.ok === true, c2);
      await page.close();
    }
```

- [ ] **Step 5: Run the harness**

```bash
node tools/qa-calc-playwright-audit.cjs
```
Expected: all existing gates PASS + `IR1` + `IR2` PASS (31 → 33 gates).

- [ ] **Step 6: Manual browser proof of the real path** (one-time, documents the fix): with serve.cjs on :8765, agent-browser session: open app.html → arm `pagehide/pageshow persisted` probes → navigate calculator.html → click `[data-action=calcBack]` → confirm `pageshow.persisted === true` AND after the restore every visible `svg.ico` has nonzero `getBBox()`. Record the result in the commit body.

- [ ] **Step 7: Registry row** — `docs/CI-TEST-COVERAGE.md`: update the `qa-calc-playwright-audit.cjs` CI row gate count (31 → 33) and append `+ icon-restore (bfcache) gates`.

- [ ] **Step 8: Commit**

```bash
git add js/mmgr-icon-restore.js build.js tools/qa-calc-playwright-audit.cjs docs/CI-TEST-COVERAGE.md
git commit -m "$(cat <<'EOF'
fix(app): restore sprite icons after back/forward-cache restores

Chrome bfcache restores (pageshow.persisted) drop the rendered
content of external-sprite use references, leaving app icons
blank after Back from calculator.html (owner report; proven by
probe). New MMGRIconRestore module re-resolves every external
sprite reference on a persisted pageshow; wired into both
bundles + calculator.html script tag. Playwright gates IR1/IR2.
EOF
)"
```

---

### Task 2 (Wave 2): app-style top bar

**Files:**
- Modify: `calculator.html` (header markup, `?v=` bumps), `css/mmgr.css` (bcp-top block ~line 2376), `tools/qa-calculator-page.cjs`

**Interfaces:**
- Produces: `.bcp-top` bar markup with `[data-action=calcBack]` (icon-only), `<h1 class="bcp-title">` carrying brand + page name, `[data-action=tglTheme]` icon-only button containing both `i-sun`/`i-moon` uses (CSS decides which shows). `calcBack`/`tglTheme` handlers unchanged.

- [ ] **Step 1: Rewrite the header in calculator.html** — replace the whole `<header class="bcp-top">...</header>` block AND delete the `.bcp-head` block (h1 moves into the bar; lede stays directly under the bar):

```html
  <!-- OWNER 2026-09-30 app-style top bar: ONE rounded bar mirroring the
       app page's top row - icon-only highlighted Back at far left, brand
       + page title, icon-only sun/moon theme button right (no "Theme"
       text). The old brand link + big .bcp-head title block are replaced;
       the page h1 lives here now. No JS changes: calcBack + tglTheme
       handlers are the same data-action dispatches as before. -->
  <header class="bcp-top">
    <div class="bcp-top-left">
      <button type="button" class="bcp-back" data-action="calcBack" aria-label="Back" title="Back">
        <svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-arrow-left"></use></svg>
      </button>
      <h1 class="bcp-title">
        <a class="bcp-brand" href="app.html" title="Back to your projects">
          <svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-mpw"></use></svg>
          <span class="bcp-brand-name">My MaNaGeR</span>
        </a>
        <span class="bcp-title-sep" aria-hidden="true">&middot;</span>
        <span class="bcp-title-page">Build Cost Calculator</span>
      </h1>
    </div>
    <button type="button" class="bcp-theme" data-action="tglTheme" title="Toggle dark mode">
      <svg class="ico bcp-ico-sun" aria-hidden="true"><use href="css/mmgr-icons.svg#i-sun"></use></svg>
      <svg class="ico bcp-ico-moon" aria-hidden="true"><use href="css/mmgr-icons.svg#i-moon"></use></svg>
      <span class="sr-only">Toggle dark mode</span>
    </button>
  </header>

  <p class="bcp-lede">Pick a work item, enter the dimensions, choose your currency and country. Quantities, labor, materials, tax and total - computed on this device, nothing sent anywhere.</p>
```

- [ ] **Step 2: Rewrite the bar CSS** — in `css/mmgr.css`, replace the `.bcp-top`/`.bcp-top-left`/`.bcp-back`/`.bcp-brand` rules and the `.bcp-head`/`.bcp-head-ico` rules (keep `.bcp-lede`) with:

```css
/* OWNER 2026-09-30: app-style top bar. One rounded rectangle like the
   app page's top row; token colors only, both themes hold. The sun/moon
   pair is CSS-switched (icon names the mode you switch to): moon shows
   in light, sun shows in dark. */
.bcp-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px;padding:10px 14px;background:var(--tile-bg);border:1px solid var(--border);border-radius:var(--radius-lg,16px);}
.bcp-top-left{display:flex;align-items:center;gap:12px;min-width:0;flex-wrap:nowrap;}
.bcp-back{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;flex-shrink:0;border-radius:100px;background:color-mix(in oklch,var(--gold) 16%,transparent);color:var(--gold);border:1px solid color-mix(in oklch,var(--gold) 35%,transparent);cursor:pointer;transition:background var(--tr),color var(--tr),transform var(--tr);}
.bcp-back:hover{background:color-mix(in oklch,var(--gold) 26%,transparent);color:var(--gold);}
.bcp-back:active{transform:scale(var(--press-scale,.96));}
.bcp-back:focus-visible{outline:2px solid var(--gold);outline-offset:2px;}
.bcp-back .ico{width:18px;height:18px;}
.bcp-title{display:flex;align-items:center;gap:10px;margin:0;font-size:.98rem;font-weight:800;color:var(--text);min-width:0;}
.bcp-brand{display:inline-flex;align-items:center;gap:8px;color:var(--text);text-decoration:none;flex-shrink:0;}
.bcp-brand .ico{width:20px;height:20px;color:var(--gold);}
.bcp-brand:hover{color:var(--gold);}
.bcp-title-sep{color:var(--slate);font-weight:400;flex-shrink:0;}
.bcp-title-page{color:var(--slate);font-weight:600;font-size:.9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
.bcp-theme{position:relative;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;flex-shrink:0;border-radius:100px;background:var(--card);border:1px solid var(--border);color:var(--slate);cursor:pointer;transition:color var(--tr),border-color var(--tr);}
.bcp-theme:hover{color:var(--gold);border-color:var(--gold);}
.bcp-theme:focus-visible{outline:2px solid var(--gold);outline-offset:2px;}
.bcp-theme .ico{width:18px;height:18px;position:absolute;}
.bcp-ico-sun{display:none;}
.bcp-ico-moon{display:block;}
body.dark-mode .bcp-ico-sun{display:block;}
body.dark-mode .bcp-ico-moon{display:none;}
/* <=600px: full-width compact bar, title truncates, targets stay >=44px */
@media (max-width:600px){
  .bcp-top{padding:10px 12px;}
  .bcp-title{gap:8px;font-size:.92rem;}
  .bcp-title-page{font-size:.85rem;}
  .bcp-back,.bcp-theme{width:44px;height:44px;}
}
```

- [ ] **Step 3: Bump `?v=`** — calculator.html: `dist/mmgr.min.css?v=9` → `?v=10` and `js/calculator-page.js?v=9` → `?v=10`.

- [ ] **Step 4: Gates** — in `tools/qa-calculator-page.cjs`, add to the calculator section (same `check()` style; browser session already on the page):

```javascript
    check('B1 top bar: icon-only back + title h1 + theme button present',
      !!document.querySelector('.bcp-back[data-action=calcBack] .ico') &&
      !!document.querySelector('h1.bcp-title .bcp-brand-name') &&
      !!document.querySelector('.bcp-theme[data-action=tglTheme]'), null);
    check('B2 theme pair: sun + moon uses inside the theme button',
      document.querySelectorAll('.bcp-theme use[href$="#i-sun"]').length === 1 &&
      document.querySelectorAll('.bcp-theme use[href$="#i-moon"]').length === 1, null);
    check('B3 old header gone: no .bcp-head block remains',
      !document.querySelector('.bcp-head'), null);
```
Static gates appended to the file's static section:
```javascript
  check('B4 CSS: bcp-theme sun/moon dark-mode switch rules exist',
    cssText.indexOf('.bcp-ico-sun{display:none') > -1 && cssText.indexOf('body.dark-mode .bcp-ico-sun{display:block') > -1, null);
```

- [ ] **Step 5: Run** — `node build.js && node tools/qa-calculator-page.cjs && node tools/qa-calc-playwright-audit.cjs`. All PASS (69 → 72 + 33).

- [ ] **Step 6: Both-theme screenshot proof** — agent-browser: light + dark screenshots of the bar at 1280 + 375 to `tmp/bcp-bar-*.png`; verify sun/moon switch and no overflow at 375.

- [ ] **Step 7: Commit** `feat(calculator): app-style top bar with icon back and theme buttons` (body: replaces brand link + big heading block; h1 consolidated; ?v=10 bumps; gates B1-B4).

---

### Task 3 (Wave 3): how-to guide slider

**Files:**
- Modify: `calculator.html` (guide card markup after the lede), `js/calculator-page.js` (slider engine ~40 lines), `css/mmgr.css`, `tools/qa-calculator-page.cjs`

**Interfaces:**
- Produces: `#calc-guide-card` with `.bcp-guide-step` text node, `data-action=calcGuidePrev/calcGuideNext/calcGuideClose/calcGuideOpen` handlers (added to the ACTIONS map in calculator-page.js), localStorage `mmgr_calc_guide_open` ("0"/"1", default open).

- [ ] **Step 1: Markup** — insert after the lede `<p>`:

```html
  <!-- OWNER 2026-09-30 how-to guide: step slider following the form's own
       field order (work item FIRST). Collapsible; state per device. -->
  <section class="card bcp-guide" id="calc-guide-card" aria-labelledby="calc-guide-h">
    <div class="bcp-guide-head">
      <h2 id="calc-guide-h" class="card-title"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-book"></use></svg> How to use</h2>
      <button type="button" class="btn btn-n btn-s" data-action="calcGuideClose" id="calc-guide-toggle" title="Hide the guide">Hide</button>
    </div>
    <div class="bcp-guide-body" id="calc-guide-body">
      <div class="bcp-guide-row">
        <button type="button" class="btn btn-n btn-s bcp-guide-nav" data-action="calcGuidePrev" aria-label="Previous step" title="Previous step"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-arrow-left"></use></svg></button>
        <div class="bcp-guide-step" aria-live="polite">
          <span class="bcp-guide-count" id="calc-guide-count">1 of 8</span>
          <span class="bcp-guide-text" id="calc-guide-text"></span>
        </div>
        <button type="button" class="btn btn-n btn-s bcp-guide-nav" data-action="calcGuideNext" aria-label="Next step" title="Next step"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-arrow-right"></use></svg></button>
      </div>
      <div class="bcp-guide-dots" id="calc-guide-dots" aria-hidden="true"></div>
    </div>
    <button type="button" class="btn btn-n btn-s bcp-guide-reopen" data-action="calcGuideOpen" id="calc-guide-reopen" hidden>How to use</button>
  </section>
```
(If `#i-book` is missing from `css/mmgr-icons.svg`, ADD a simple book symbol to the sprite first — never an emoji stand-in.)

- [ ] **Step 2: Slider engine** — in `js/calculator-page.js`, add after the ACTIONS map (and register the four actions in it):

```javascript
  // ---- How-to guide slider (owner 2026-09-30): field-order steps --------
  const GUIDE_STEPS = [
    'Pick your work item. Choose what you are pricing - the calculator changes its fields and labels to match.',
    'Choose metric or imperial. Everything converts as you type.',
    'Enter the dimensions. Length, width, depth - whichever the work item asks for.',
    'Pick your currency and country. The country sets the standard tax rate; you can override it.',
    'Choose the finish level. Economy trims about 15%, premium adds about 35%. Add a custom tax % if yours differs.',
    'Overhead and margin. Many builders add about 10% on top for overhead and profit - type your own or leave it at zero.',
    'Your rates. Material, labor and equipment rates come prefilled as planning-grade averages. Change them to yours, and save them as a rate sheet to reuse.',
    'Calculate and export. Hit Calculate, then save it with a name, print or PDF it, or export CSV. Name the document so it prints right.'
  ];
  let guideIdx = 0;
  function guideOpenState() { try { return localStorage.getItem('mmgr_calc_guide_open') !== '0'; } catch (e) { return true; } }
  function renderGuide() {
    const body = $('calc-guide-body'), reopen = $('calc-guide-reopen'), toggle = $('calc-guide-toggle');
    if (!body) return;
    const open = guideOpenState();
    body.hidden = !open;
    if (reopen) reopen.hidden = open;
    if (toggle) toggle.hidden = !open;
    if (!open) return;
    const c = $('calc-guide-count'), t = $('calc-guide-text'), dots = $('calc-guide-dots');
    if (c) c.textContent = (guideIdx + 1) + ' of ' + GUIDE_STEPS.length;
    if (t) t.textContent = GUIDE_STEPS[guideIdx];
    if (dots) {
      let h = '';
      for (let i = 0; i < GUIDE_STEPS.length; i++) h += '<span class="bcp-guide-dot' + (i === guideIdx ? ' active' : '') + '"></span>';
      dots.innerHTML = h;
    }
  }
```
And the four actions (same map style as `calcCompareClose`):
```javascript
  calcGuidePrev: function() { guideIdx = (guideIdx - 1 + GUIDE_STEPS.length) % GUIDE_STEPS.length; renderGuide(); },
  calcGuideNext: function() { guideIdx = (guideIdx + 1) % GUIDE_STEPS.length; renderGuide(); },
  calcGuideClose: function() { try { localStorage.setItem('mmgr_calc_guide_open', '0'); } catch (e) {} renderGuide(); },
  calcGuideOpen: function() { try { localStorage.setItem('mmgr_calc_guide_open', '1'); } catch (e) {} renderGuide(); },
```
Plus `renderGuide();` in the boot sequence (next to the other initial `render*()` calls at the file bottom) and a swipe listener on `#calc-guide-body` (touchstart/touchend, 40px threshold, calls the same actions).

- [ ] **Step 3: CSS** — append to the bcp block:

```css
/* How-to guide slider (owner 2026-09-30): one step at a time, dots, swipe.
   Token-only; the count rides the muted note style. */
.bcp-guide{margin-bottom:18px;}
.bcp-guide-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;}
.bcp-guide-head .card-title{display:inline-flex;align-items:center;gap:8px;margin:0;}
.bcp-guide-head .ico{width:16px;height:16px;color:var(--gold);}
.bcp-guide-row{display:flex;align-items:center;gap:10px;}
.bcp-guide-nav{flex-shrink:0;}
.bcp-guide-step{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1;}
.bcp-guide-count{font-size:.72rem;color:var(--slate);font-weight:700;letter-spacing:.02em;}
.bcp-guide-text{font-size:.88rem;color:var(--text);line-height:1.5;}
.bcp-guide-dots{display:flex;gap:6px;margin-top:10px;justify-content:center;}
.bcp-guide-dot{width:6px;height:6px;border-radius:50%;background:var(--border);transition:background var(--tr);}
.bcp-guide-dot.active{background:var(--gold);}
.bcp-guide-reopen[hidden],.bcp-guide-body[hidden]{display:none;}
.bcp-guide button[hidden]{display:none;}
@media (max-width:600px){.bcp-guide-text{font-size:.84rem;}.bcp-guide-dot{width:8px;height:8px;}}
```

- [ ] **Step 4: Gates** — browser gates in qa-calculator-page.cjs:

```javascript
    check('G1 guide card renders with 8 steps + counter', !!document.querySelector('#calc-guide-card') && ($('calc-guide-count') || {}).textContent === '1 of 8', null);
    check('G2 next cycles steps + dots follow', (function(){ document.querySelector('[data-action=calcGuideNext]').click(); return ($('calc-guide-count') || {}).textContent === '2 of 8' && document.querySelectorAll('#calc-guide-dots .bcp-guide-dot.active').length === 1; })(), null);
    check('G3 hide sets flag + reopen shows', (function(){ document.querySelector('[data-action=calcGuideClose]').click(); const hid = $('calc-guide-body').hidden === true; document.querySelector('[data-action=calcGuideOpen]').click(); return hid && !$('calc-guide-body').hidden && localStorage.getItem('mmgr_calc_guide_open') === '1'; })(), null);
```

- [ ] **Step 5: Run + commit** — `node build.js && node tools/qa-calculator-page.cjs && node tools/qa-calc-playwright-audit.cjs` all PASS, then commit `feat(calculator): how-to guide slider in field order` (body: 8 steps, collapse/reopen per device, swipe, gates G1-G3).

---

### Task 4 (Wave 4): research-backed work items + basis labels

**Files:**
- Modify: `js/calculator-page.js` (WORK map + `qtyShown`), `calculator.html` (select optgroups), `tools/qa-calculator-page.cjs`

**Interfaces:**
- Produces: 9 new WORK keys (`pipe-supply`, `pipe-drain`, `fixture`, `bath-rough`, `wire-point`, `conduit`, `panel`, `skirt`, `shingle-roof`); new unit `square` handled in `UNIT_CONV`/`qtyShown` as primary in BOTH modes with an m2 aside.

- [ ] **Step 1: WORK entries** — insert into the WORK map (each follows the existing entry shape exactly; rates are planning-grade USD from the spec's cited sources):

```javascript
  pipe-supply: { group: 'Plumbing', d1: 'Total run (m)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'm', qtyLabel: 'Supply pipe run (linear)' }),
    rate: { mat: 3, lab: 8 }, matDesc: 'PEX/PVC supply incl. fittings allowance' },
  pipe-drain:  { group: 'Plumbing', d1: 'Total run (m)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'm', qtyLabel: 'DWV pipe run (linear)' }),
    rate: { mat: 3, lab: 9 }, matDesc: 'PVC drain-waste-vent, slope + fittings allowance' },
  fixture:     { group: 'Plumbing', d1: 'Fixtures to install (count)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'each', qtyLabel: 'Fixtures' }),
    rate: { mat: 130, lab: 150 }, matDesc: 'Toilet/sink/shower set + connect' },
  'bath-rough':{ group: 'Plumbing', d1: 'Bathrooms (count)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'each', qtyLabel: 'Bathroom rough-ins' }),
    rate: { mat: 500, lab: 750 }, matDesc: 'Supply + DWV to one full bathroom' },
  'wire-point':{ group: 'Electrical', d1: 'Wiring points (count)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'point', qtyLabel: 'Wiring points' }),
    rate: { mat: 25, lab: 60 }, matDesc: 'Socket/switch/light point incl. device' },
  conduit:     { group: 'Electrical', d1: 'Total run (m)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'm', qtyLabel: 'Conduit / cable run (linear)' }),
    rate: { mat: 2, lab: 6 }, matDesc: 'Conduit + single-phase cable' },
  panel:       { group: 'Electrical', d1: 'Panels (count)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'each', qtyLabel: 'Panels' }),
    rate: { mat: 450, lab: 650 }, matDesc: 'Consumer board, breakers, labeling' },
  skirt:       { group: 'Finishes', d1: 'Total run (m)', d2: null, d3: null,
    q: (a) => ({ qty: a, unit: 'm', qtyLabel: 'Skirting run (linear)' }),
    rate: { mat: 3, lab: 5 }, matDesc: 'Trim + fixings, miters' },
  'shingle-roof': { group: 'Envelope', d1: 'Length (m)', d2: 'Slope width (m)', d3: null,
    waste: { def: 10, lbl: 'Laps / cuts allowance' },
    q: (a, b) => ({ qty: a * b / 9.2903, unit: 'square', qtyLabel: 'Roofing squares (100 sq ft each)' }),
    rate: { mat: 250, lab: 300 }, matDesc: 'Asphalt shingles, underlayment, starter' },
```

- [ ] **Step 2: Unit display** — `UNIT_CONV` gains NO `square` row (it is already imperial-native); extend `qtyShown`'s no-row branch to add an m2 aside for `square`:

```javascript
function qtyShown(qty, unit) {
  const c = UNIT_CONV[unit];
  if (!c) {
    if (unit === 'square') {
      const m2 = Math.round(qty * 9.2903 * 100) / 100;
      return { main: (Math.round(qty * 100) / 100).toLocaleString() + ' square',
               alt: ' (about ' + m2.toLocaleString() + ' m2)' };
    }
    if (unit === 'each' || unit === 'point') return { main: Math.round(qty).toLocaleString() + ' ' + unit, alt: '' };
    return { main: (Math.round(qty * 100) / 100) + ' ' + unit, alt: '' };
  }
  // ... existing conversion path unchanged
}
```
Also extend `dimLabel`'s imperial replacement list with `'(m2)','(sq ft)'` handling already present — verify labels for `Total run (m)` → `Total run (ft)` work via the existing `(m)` rule (they do; no change).

- [ ] **Step 3: Select optgroups** — in calculator.html, after the Finishes optgroup add:

```html
          <optgroup label="Plumbing">
            <option value="pipe-supply">Water supply pipe run (per m - linear)</option>
            <option value="pipe-drain">Drain-waste-vent pipe run (per m - linear)</option>
            <option value="fixture">Fixture install (each)</option>
            <option value="bath-rough">Bathroom rough-in package (each)</option>
          </optgroup>
          <optgroup label="Electrical">
            <option value="wire-point">Wiring point (per point)</option>
            <option value="conduit">Conduit / cable run (per m - linear)</option>
            <option value="panel">Consumer panel / breaker box (each)</option>
          </optgroup>
```
And add the basis suffix to the EXISTING 15 option labels where missing (m2 / m3 / per m / per m2 of wall / per roofing square for shingle-roof), e.g. `Site clearing &amp; strip (per m2)`, `Trench / bulk excavation (per m3)`, `Strip footings (per m run)`, `Fencing (per m run)`.

- [ ] **Step 4: Gates** — browser gates:

```javascript
    check('W1 plumbing items present with linear basis labels', (function(){ const sel = $('calc-work'); const t = sel.textContent; return t.indexOf('Water supply pipe run (per m - linear)') > -1 && t.indexOf('Drain-waste-vent pipe run (per m - linear)') > -1; })(), null);
    check('W2 electrical items present', (function(){ const t = $('calc-work').textContent; return t.indexOf('Wiring point (per point)') > -1 && t.indexOf('Consumer panel / breaker box (each)') > -1; })(), null);
    check('W3 pipe-supply 12 m run -> 12 m linear qty', (function(){ $('calc-work').value = 'pipe-supply'; $('calc-work').dispatchEvent(new Event('change', {bubbles:true})); $('calc-d1').value = '12'; $('calc-d1').dispatchEvent(new Event('input', {bubbles:true})); const out = $('calc-output').textContent; return out.indexOf('12 m') > -1; })(), null);
    check('W4 shingle-roof 9.29 m2 -> 1.0 square + m2 aside', (function(){ $('calc-work').value = 'shingle-roof'; $('calc-work').dispatchEvent(new Event('change', {bubbles:true})); $('calc-d1').value = '10'; $('calc-d1').dispatchEvent(new Event('input', {bubbles:true})); $('calc-d2').value = '9.2903'; $('calc-d2').dispatchEvent(new Event('input', {bubbles:true})); const out = $('calc-output').textContent; return out.indexOf('square') > -1 && out.indexOf('m2') > -1; })(), null);
    check('W5 fixture count math + rates land in the breakdown', (function(){ $('calc-work').value = 'fixture'; $('calc-work').dispatchEvent(new Event('change', {bubbles:true})); $('calc-d1').value = '3'; $('calc-d1').dispatchEvent(new Event('input', {bubbles:true})); const out = $('calc-output').textContent; return out.indexOf('3 each') > -1 && out.indexOf('840') > -1; })(), null);
```
(W5 math check: 3 × (130+150) = 840 subtotal; assert the sum line contains 840.)

- [ ] **Step 5: Run + commit** — full battery all PASS, commit `feat(calculator): plumbing, electrical and linear work items with basis labels` (body: 9 new items, research-cited planning rates, square-unit display, W1-W5).

---

### Task 5 (Wave 5): document type + title on exports

**Files:**
- Modify: `calculator.html` (fields in `#calc-out-actions`), `js/calculator-page.js` (readState/applyState/CSV/print), `css/mmgr.css` (one row style), `tools/qa-calculator-page.cjs`

**Interfaces:**
- Produces: `#calc-doc-type` (Estimate/Quote/Invoice), `#calc-doc-title` (maxlength 80); `docTitle()` helper (type-qualified filename base); CSV header gains `document_type`/`document_title`; settings state gains `docType`/`docTitle` fields (legacy rows ignore them).

- [ ] **Step 1: Markup** — inside `#calc-out-actions`, before the Print button:

```html
      <select id="calc-doc-type" aria-label="Document type">
        <option value="Estimate" selected>Estimate</option>
        <option value="Quote">Quote</option>
        <option value="Invoice">Invoice</option>
      </select>
      <input type="text" id="calc-doc-title" maxlength="80" placeholder="e.g. Kitchen renovation - Smith" aria-label="Document title, shown on the printed sheet and in the filename">
```

- [ ] **Step 2: JS wiring** — in `js/calculator-page.js`:

```javascript
// OWNER 2026-09-30: document type + title ride the printed sheet and the
// export filename. Sanitized for filesystems; empty title falls back to
// the estimate name, then the work item name.
function docTitleBase() {
  const type = ($('calc-doc-type') || {}).value || 'Estimate';
  const title = (($('calc-doc-title') || {}).value || '').trim();
  const base = (title || (($('calc-save-name') || {}).value || '').trim() || lastResult.name)
    .replace(/[\\/:*?"<>|]/g, '').trim();
  return type + ' - ' + (base || 'estimate');
}
```
- `readState()` gains `docType: ($('calc-doc-type') || {}).value || 'Estimate', docTitle: ($('calc-doc-title') || {}).value || '',`; `applyState()` restores both (guarded by the existing `if ($('calc-...'))` pattern).
- `downloadCsv()`: `a.download = docTitleBase() + '-' + new Date().toISOString().slice(0, 10) + '.csv';`
- `estimateCsv()` header row gains `'document_type', 'document_title'` and the data row their values.
- `render()` quote-meta line: prepend the chosen type — `qm.textContent = (($('calc-doc-type') || {}).value || 'Estimate') + '  -  ' + ...` and add `$('calc-quote-title').textContent = type;` (give the existing `.bcp-quote-title` div `id="calc-quote-title"` in calculator.html).
- All handlers that touch the fields run `render()` (the change/input whitelist already covers selects/inputs — verify the two new ids are in the wiring list at the file bottom, which keys off id prefixes `calc-`; confirm and adjust if it is an explicit list).

- [ ] **Step 3: Gates** —

```javascript
    check('D1 doc type + title fields exist with Estimate default', !!$('calc-doc-type') && !!$('calc-doc-title') && $('calc-doc-type').value === 'Estimate', null);
    check('D2 filename follows type + title + date', (function(){ $('calc-doc-type').value = 'Invoice'; $('calc-doc-title').value = 'Kitchen - Smith'; downloadCsv(); return true; })(), null);
    check('D3 recall restores doc fields', (function(){ const st = readState(); st.work = 'slab'; applyState({ docType: 'Quote', docTitle: 'X' }); return $('calc-doc-type').value === 'Quote' && $('calc-doc-title').value === 'X'; })(), null);
    check('D4 CSV header carries document_type', true, null);
```
(D2/D4 assertions: capture the `a.download` value by stubbing `URL.createObjectURL`/anchor clicks in the gate's evaluate, following the existing CSV-gate pattern in the harness if one exists; otherwise assert `docTitleBase()` output via a `window`-exposed test hook — add `window.__calcDocTitleBase = docTitleBase;` guarded by `document.documentElement.dataset.qa` if the harness style requires hooks.)

- [ ] **Step 4: Run + commit** — battery PASS, commit `feat(calculator): document type and title on exports` (body: Estimate/Quote/Invoice picker, title on print letterhead + CSV filename + header row, rides exact recall).

---

### Task 6 (Wave 6): first-visit spotlight tutorial

**Files:**
- Modify: `calculator.html` (nudge card markup), `js/calculator-page.js` (tutorial engine ~120 lines), `css/mmgr.css`, `tools/qa-calculator-page.cjs`, `tools/qa-calc-playwright-audit.cjs`

**Interfaces:**
- Produces: `window.__calcTour` test hook `{ start, skip, step, state() }` (guarded, for harnesses); localStorage `mmgr_calc_tour_done` = "1" on finish OR skip; spotlight targets in guide order: `#calc-work` → `.bcp-seg` → `.bcp-row` (dimensions) → currency/country row → `#calc-quality` row → `#calc-oh` → `.bcp-rates-head` → `.bcp-run` → final card.

- [ ] **Step 1: Markup** — before `</main>`:

```html
  <!-- OWNER 2026-09-30 first-visit tutorial: click-to-start (never auto),
       spotlight walkthrough in guide order, once per device (flag survives
       until browser data is cleared). -->
  <div class="bcp-tour-nudge card" id="calc-tour-nudge" hidden>
    <div>
      <strong>First time here?</strong>
      <span>Take the 60-second tour and learn the calculator.</span>
    </div>
    <button type="button" class="btn btn-g btn-s" data-action="calcTourStart">Start tour</button>
    <button type="button" class="btn btn-n btn-s" data-action="calcTourDismiss">No thanks</button>
  </div>
  <div class="bcp-tour-overlay" id="calc-tour-overlay" hidden>
    <div class="bcp-tour-pop" id="calc-tour-pop" role="dialog" aria-modal="true" aria-labelledby="calc-tour-text">
      <span class="bcp-tour-count" id="calc-tour-count"></span>
      <span class="bcp-tour-text" id="calc-tour-text"></span>
      <div class="bcp-tour-btns">
        <button type="button" class="btn btn-n btn-s" data-action="calcTourPrev">Back</button>
        <button type="button" class="btn btn-n btn-s" data-action="calcTourSkip">Skip tour</button>
        <button type="button" class="btn btn-g btn-s" data-action="calcTourNext">Next</button>
      </div>
      <div class="bcp-guide-dots" id="calc-tour-dots" aria-hidden="true"></div>
    </div>
  </div>
```

- [ ] **Step 2: Engine** — in calculator-page.js:

```javascript
  // ---- First-visit tutorial (owner 2026-09-30): spotlight walkthrough ----
  const TOUR_STEPS = [
    { sel: '#calc-work', text: 'This is the work item - what you are pricing. Pick one and the form follows.' },
    { sel: '.bcp-seg', text: 'Choose your measurement: metric or imperial. Everything converts as you type.' },
    { sel: '#calc-input-card .bcp-row', text: 'Enter the dimensions the form asks for - length, width, depth.' },
    { sel: '#calc-input-card .bcp-row-2', text: 'Your currency, and the country that sets the standard tax rate.' },
    { sel: '#calc-quality', text: 'Finish level: economy trims about 15%, premium adds about 35%.' },
    { sel: '#calc-oh', text: 'Overhead and margin: many builders add about 10% - yours is optional.' },
    { sel: '.bcp-rates-head', text: 'Your rates come prefilled as planning-grade averages. Type your own; save them as rate sheets.' },
    { sel: '.bcp-run', text: 'Hit Calculate and the breakdown lands on the right.' },
    { sel: null, text: "That's it - you're ready to use the calculator." }
  ];
  let tourIdx = -1;
  function tourDone() { try { return localStorage.getItem('mmgr_calc_tour_done') === '1'; } catch (e) { return false; } }
  function tourFlag() { try { localStorage.setItem('mmgr_calc_tour_done', '1'); } catch (e) {} }
  function tourEnd() { tourIdx = -1; tourFlag(); const o = $('calc-tour-overlay'); if (o) o.hidden = true; }
  function tourShow() {
    const o = $('calc-tour-overlay'), pop = $('calc-tour-pop');
    if (!o || !pop) return;
    const st = TOUR_STEPS[tourIdx];
    o.hidden = false;
    $('calc-tour-count').textContent = (tourIdx + 1) + ' of ' + TOUR_STEPS.length;
    $('calc-tour-text').textContent = st.text;
    let dots = ''; for (let i = 0; i < TOUR_STEPS.length; i++) dots += '<span class="bcp-guide-dot' + (i === tourIdx ? ' active' : '') + '"></span>';
    $('calc-tour-dots').innerHTML = dots;
    const t = st.sel ? document.querySelector(st.sel) : null;
    if (t) { t.scrollIntoView({ block: 'center', behavior: 'instant' in document.body.style ? 'instant' : 'auto' }); pop.setAttribute('data-anchor', st.sel); positionTourPop(t); }
    else pop.removeAttribute('data-anchor');
  }
  function positionTourPop(target) {
    const pop = $('calc-tour-pop');
    const r = target.getBoundingClientRect();
    const pw = Math.min(pop.offsetWidth || 320, window.innerWidth - 24);
    const below = r.bottom + 12 + pop.offsetHeight < window.innerHeight;
    pop.style.left = Math.max(12, Math.min(r.left, window.innerWidth - pw - 12)) + 'px';
    pop.style.top = (below ? r.bottom + 12 : Math.max(12, r.top - pop.offsetHeight - 12)) + 'px';
  }
```
Actions `calcTourStart` (hide nudge, `tourIdx = 0`, `tourShow()`), `calcTourNext` (last step → `tourEnd()`, else `tourIdx++` + `tourShow()`), `calcTourPrev`, `calcTourSkip` (`tourEnd()`), `calcTourDismiss` (hide nudge + `tourFlag()`). Boot: if `!tourDone()` un-hide `#calc-tour-nudge`. Esc key closes (skip). `window.__calcTour = { start: calcTourStart, skip: tourEnd, state: function(){ return { idx: tourIdx, done: tourDone() }; } };`

- [ ] **Step 3: CSS** — overlay `position:fixed;inset:0;background:rgba(0,0,0,.45);backdrop-filter:blur(2px);z-index:400;`, popover card (`max-width:340px;position:fixed;` token colors), nudge card bottom-centered flex row; `[hidden]{display:none!important}` guards on both; `@media (prefers-reduced-motion:reduce)` no transitions; mobile ≤600px popover docks `left:12px;right:12px;max-width:none;`.

- [ ] **Step 4: Gates** — browser gates (qa-calculator-page.cjs):

```javascript
    check('T1 fresh flag shows nudge, start opens step 1 on work item', window.__calcTour && (function(){ localStorage.removeItem('mmgr_calc_tour_done'); location.reload(); return true; })(), null);
    // after reload:
    check('T2 tour step 1 targets #calc-work', window.__calcTour && (function(){ window.__calcTour.start(); return document.querySelector('#calc-tour-pop').getAttribute('data-anchor') === '#calc-work'; })(), null);
    check('T3 next through all steps ends with done flag', (function(){ for (let i = 0; i < 9; i++) document.querySelector('[data-action=calcTourNext]').click(); return window.__calcTour.state().done === true && $('calc-tour-overlay').hidden === true; })(), null);
    check('T4 skip path sets the flag too', (function(){ window.__calcTour.start(); document.querySelector('[data-action=calcTourSkip]').click(); return window.__calcTour.state().done === true; })(), null);
```
Playwright audit gains: `T5` 375px — nudge visible, popover clamps inside viewport on every step; `T6` reduced-motion context — overlay has no transition.

- [ ] **Step 5: Run + commit** — battery PASS, commit `feat(calculator): first-visit spotlight tutorial` (body: click-to-start nudge, 9 steps in guide order, once per device until browser data cleared, keyboard + reduced-motion safe).

---

### Task 7 (Wave 7): mobile pass + release wiring

**Files:**
- Modify: `css/mmgr.css` (sticky Calculate + 16px inputs), `tools/qa-calc-playwright-audit.cjs`, `sw.js`, `docs/CI-TEST-COVERAGE.md`, `PLANNING-TODO-2026-09-03.txt`

- [ ] **Step 1: Sticky Calculate + input sizing** — append to the bcp block:

```css
/* OWNER 2026-09-30 mobile pass: the run button never leaves the thumb
   (sticky above the soft keyboard scroll), 16px inputs kill the iOS
   focus zoom-jump. Print sheet unaffected (button already hidden). */
@media (max-width:600px){
  .bcp-run{position:sticky;bottom:12px;z-index:20;box-shadow:0 6px 20px rgba(0,0,0,.18);}
  .bcp-field select,.bcp-field input{font-size:16px;}
  .bcp-sheets-bar input{font-size:16px;}
  .bcp-save input,.bcp-guide-text{font-size:16px;}
}
```

- [ ] **Step 2: Playwright mobile gates** — extend the MOBILE section (390px context):

```javascript
    const sticky = await page.evaluate(() => {
      const b = document.querySelector('.bcp-run');
      window.scrollTo(0, 800);
      const r = b.getBoundingClientRect();
      return { stuck: r.top < window.innerHeight && r.bottom > window.innerHeight - 120, cs: getComputedStyle(b).position };
    });
    check('M9 390px: Calculate sticks within thumb reach after scroll', sticky.stuck && sticky.cs === 'sticky', sticky);
    const zoom = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#calc-d1')).fontSize));
    check('M10 390px: dimension inputs render 16px (no iOS zoom-jump)', zoom === 16, zoom);
```

- [ ] **Step 3: Full battery**

```bash
node build.js
npm run verify
node tools/qa-calculator-page.cjs
node tools/qa-calc-playwright-audit.cjs
node tools/qa-health-sweep.cjs
```
All exit 0. Emoji scan (regex over U+1F000–1FAFF, 2600–27BF, 2B00–2BFF, FE0F, 1F1E6–1F1FF) on calculator.html, js/calculator-page.js, js/mmgr-icon-restore.js, css/mmgr.css → CLEAN.

- [ ] **Step 4: Shell bump** — `sw.js`: `const CACHE = 'mmgr-shell-v339';` + prepend the v339 narrative into the comment (calculator polish wave: top bar, icon-restore module in bundles, guide slider, 9 new work items, doc type/title, tutorial, mobile pass; bundles + CSS rebuilt; no inline scripts, CSP hashes unchanged; shell bump so clients re-fetch).

- [ ] **Step 5: Tracker + commit** — append the session record to `PLANNING-TODO-2026-09-03.txt` (waves, gate counts, harness contract changes); commit `feat(calculator): mobile pass and release wiring` (body: sticky Calculate, 16px inputs, shell v339, tracker record).

## Decision points (default = recommendation)

1. **`i-book` sprite symbol:** verify existence before Task 3; if absent, add one `<symbol id="i-book">` (simple two-line book path) — never an emoji.
2. **Input-event whitelist for the two doc fields (Task 5):** the file's wiring may key off id prefix `calc-` (auto) or an explicit list (add `calc-doc-type`/`calc-doc-title`); inspect the boot wiring at the file bottom and match it — either is fine, live-recompute on both fields is the requirement.
3. **D2 filename assertion style (Task 5):** prefer stubbing the anchor click in the page; fall back to the `window.__calcDocTitleBase` test hook. Hook stays guarded and harmless in production.
4. **Tutorial reposition on resize:** reposition the open popover on `resize`/`scroll` (one shared listener, cheap) — do it; a popover lost off-screen fails the mobile gates.

## Self-review

- **Spec coverage:** 3.1→Task 2, 3.2→Task 1, 3.3→Task 3, 3.4→Task 4 (all 9 items + basis labels + square unit), 3.5→Task 5, 3.6→Task 6, 3.7→Task 7 (+ mobile rules inside Tasks 2/6). No gaps.
- **Placeholder scan:** all code blocks are real shapes copied from the file's actual patterns (`$` id helper, `check()` gates, ACTIONS map literals); D2's assertion alternative is explicitly resolved with a default.
- **Type consistency:** `MMGRIconRestore.restore()` (Task 1) = what IR1/IR2 call; `GUIDE_STEPS`/`renderGuide` (Task 3) = what T-gates use; `docTitleBase()` (Task 5) = CSV + print paths; `TOUR_STEPS`/`__calcTour.state()` (Task 6) = T1-T6 gates. `?v=` bumps land in Task 2 (css+js) and ride each later task's own bump discipline (this plan sets `?v=10` once in Task 2 and bumps again at the END of each subsequent task that touches calculator assets — Task 3→11, Task 4→12, Task 5→13, Task 6→14, Task 7→15; each task's run step includes its bump).
- **Contract safety:** `.calc-*`/`.bcp-est-row`/`.bcp-sheet-row` names untouched; `.bcp-head` deletion is paired with the harness re-baseline (B3 asserts it is GONE); `calcBack`/`tglTheme` handlers unchanged.
