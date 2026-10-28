#!/usr/bin/env node
/* ============================================================
   tools/qa-calc-controls.cjs
   GATE: T-DARK (UI-1), T-ROWS (UI-2), UI-3 notes, T-PERF-WIRE, UI-4 bar parity
   ------------------------------------------------------------
   REFINEMENT-DIRECTIVE-2026-10-24, Wave D + E. Five contracts, one page:

   UI-1 - the trade picker is an owned listbox (js/mmgr-combobox.js), not a
          native popup the browser paints and no test can see. This gate opens
          it in light, dark, cyan and magenta, reads the COMPUTED colour of
          every option and every family heading against the colour actually
          painted behind it, and computes the WCAG ratio. 4.5:1 or it fails.
          It also proves the hidden <select> is still the source of truth:
          picking a row writes its value and fires one bubbling `change`.

   UI-2 - setting rows: a switch, the words, and a drawer. The gate scans for
          any bare checkbox left on the page, clicks row TEXT (not the switch)
          and asserts the switch flipped, asserts the drawer really opens and
          closes (height + inert, so closed fields cannot be tabbed into),
          sums the four statutory parts into the one percent the engine reads,
          proves the tax switch IS the country choice, and proves switching a
          row off returns the estimate to the same total without those values.

   UI-3 - the fine print moved into the guide's Notes tab: the lede paragraph
          is gone, every moved sentence is present verbatim, and the tablist
          answers the arrow keys with aria-selected + roving tabindex.

   PERF-1 - with mmgr_perf_mode=on before load: data-perf is on, nothing has a
          computed backdrop-filter, no WebGL context is created, and flipping
          the switch off brings the effects back without a reload.

   UI-4  - the calculator bar is the APP bar (body.db-page .top), measured
          against it in light and dark: same radius, background and shadow,
          the same 56px control band (the app bar's own reserved top row), the
          same 18px gap, a 1px divider between title and actions, the width cap
          that stops it running as a long band, the rate book button reading
          mark + name wide and mark alone at 390, and Performance Mode taking
          its blur and lift away.

   Usage:  node tools/qa-calc-controls.cjs
   Registry: docs/CI-TEST-COVERAGE.md -> CI row.
   ============================================================ */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BASE = (process.env.QA_BASE || 'http://127.0.0.1:8765').replace(/\/$/, '');
const SHOTS = path.join(ROOT, 'tmp', 'qa-calc-controls');
const log = s => process.stdout.write('[calc-controls] ' + s + '\n');
const delay = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  log(
    (ok ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (ok ? '' : '  <-- ' + JSON.stringify(detail === undefined ? null : detail).slice(0, 500))
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

/* Installed INSIDE the page. Walks up from an element until it finds a painted
   background, so an option's own transparent background is measured against
   the card it actually sits on - the same thing the eye sees. */
const CONTRAST_HELPERS = `window.__mmcbContrast = (function () {
  function parseRgb(s) {
    var m = String(s || '').match(/rgba?\\(([^)]+)\\)/);
    if (!m) { return null; }
    var p = m[1].split(',').map(function (x) { return parseFloat(x); });
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function bgOf(el) {
    // Composite every translucent layer down to an opaque one - the active row
    // is 12% gold over the card, and treating that as solid would measure a
    // colour nobody ever sees.
    var stack = [];
    var n = el;
    while (n && n.nodeType === 1) {
      var c = parseRgb(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.001) {
        stack.push(c);
        if (c.a >= 0.999) { break; }
      }
      n = n.parentElement;
    }
    var base = { r: 255, g: 255, b: 255 };
    for (var i = stack.length - 1; i >= 0; i--) {
      var l = stack[i];
      base = {
        r: l.r * l.a + base.r * (1 - l.a),
        g: l.g * l.a + base.g * (1 - l.a),
        b: l.b * l.a + base.b * (1 - l.a)
      };
    }
    return base;
  }
  function lum(c) {
    function ch(v) {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }
  function ratio(el) {
    var fg = parseRgb(getComputedStyle(el).color);
    var bg = bgOf(el);
    if (!fg) { return 0; }
    var a = lum(fg), b = lum(bg);
    var hi = Math.max(a, b), lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }
  return { ratio: ratio, bgOf: bgOf };
})();`;

(async () => {
  let srv = null;
  try {
    const h = await fetch(BASE + '/calculator.html');
    if (!h.ok) {
      throw new Error('not ok');
    }
  } catch (e) {
    log('starting serve.cjs for this run');
    srv = spawn(process.execPath, ['serve.cjs'], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 40; i++) {
      await delay(1000);
      try {
        const h = await fetch(BASE + '/calculator.html');
        if (h.ok) {
          break;
        }
      } catch (err) {
        /* still starting */
      }
    }
  }

  try {
    fs.mkdirSync(SHOTS, { recursive: true });
  } catch (e) {
    /* keep going - a screenshot is evidence, not a gate */
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

  const MODES = ['light', 'dark', 'cyan', 'magenta'];

  /* Open a page with a chosen theme (and optionally Performance Mode) already
     in storage, so the boot scripts apply it before first paint. */
  async function open(theme, perfOn) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 200)));
    await page.addInitScript(
      ([t, perf]) => {
        try {
          localStorage.setItem('mmgr_theme', t);
          if (perf) {
            localStorage.setItem('mmgr_perf_mode', 'on');
          } else {
            localStorage.removeItem('mmgr_perf_mode');
          }
        } catch (e) {}
      },
      [theme, !!perfOn]
    );
    await page.goto(BASE + '/calculator.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => !!window.MMGR_CALC_POPULATE, null, { timeout: 30000 });
    await delay(250);
    return { ctx, page, errors };
  }

  try {
    // ------------------------------------------------------------------
    // D0: the pickers are the owned listbox, the selects are the truth.
    // ------------------------------------------------------------------
    {
      const { page } = await open('light', false);
      const d0 = await page.evaluate(() => {
        const C = window.MMGR && window.MMGR.Combobox;
        const work = document.getElementById('calc-work');
        const fam = document.getElementById('calc-family');
        return {
          module: !!C,
          work: !!(C && C.isEnhanced('calc-work')),
          fam: !!(C && C.isEnhanced('calc-family')),
          workHidden: work ? getComputedStyle(work).display === 'none' : false,
          famHidden: fam ? getComputedStyle(fam).display === 'none' : false,
          workAria: work ? work.getAttribute('aria-hidden') : null,
          count: document.querySelectorAll('.mmcb').length
        };
      });
      check(
        'D0 both trade pickers are owned listboxes and the native selects stay as the truth',
        d0.module && d0.work && d0.fam && d0.workHidden && d0.famHidden && d0.workAria === 'true',
        d0
      );

      // The change contract every existing handler depends on.
      await page.click('.mmcb[data-for="calc-work"] .mmcb-input');
      await page.waitForSelector('.mmcb[data-for="calc-work"] [role="option"]', { timeout: 8000 });
      const target = await page.evaluate(() => {
        const sel = document.getElementById('calc-work');
        const rows = Array.prototype.slice.call(
          sel.__mmcb.list.querySelectorAll('[role="option"]')
        );
        // Skip the two special paths at the end of the list: `custom` opens its
        // own four fields and `jic` starts a two-step book pick that re-selects
        // a trade. Both are covered by their own suites; this gate is about the
        // picker's change contract.
        const normal = rows.filter(r => {
          const v = r.getAttribute('data-value');
          return v !== 'custom' && v !== 'jic';
        });
        const pick = normal[normal.length - 1];
        window.__mmcbChanges = 0;
        sel.addEventListener('change', () => {
          window.__mmcbChanges++;
        });
        return { id: pick.id, value: pick.getAttribute('data-value') };
      });
      // A real pointer press - the module reacts to pointerdown, exactly as a
      // thumb on a phone does (a synthetic .click() would prove nothing).
      await page.click('#' + target.id);
      const fired = await page.evaluate(() => {
        const sel = document.getElementById('calc-work');
        return {
          n: window.__mmcbChanges,
          value: sel.value,
          label: sel.__mmcb.input.value,
          closed: sel.__mmcb.pop.hidden
        };
      });
      check(
        'D0 a picked row writes the select value, fires one change and closes the list',
        fired.n === 1 &&
          fired.value === target.value &&
          fired.label.length > 0 &&
          fired.closed === true,
        { target, fired }
      );
      await page.context().close();
    }

    // ------------------------------------------------------------------
    // T-DARK: contrast of every option and family heading, per theme.
    // ------------------------------------------------------------------
    for (const mode of MODES) {
      const { page, errors } = await open(mode, false);
      await page.evaluate(CONTRAST_HELPERS);

      // The work list is the one with <optgroup> families - the reported bug.
      await page.click('.mmcb[data-for="calc-work"] .mmcb-input');
      await page.waitForSelector('.mmcb[data-for="calc-work"] .mmcb-pop:not([hidden])', {
        timeout: 8000
      });

      const probe = await page.evaluate(() => {
        const R = window.__mmcbContrast.ratio;
        const wrap = document.querySelector('.mmcb[data-for="calc-work"]');
        const pop = wrap.querySelector('.mmcb-pop');
        const opts = Array.prototype.slice.call(pop.querySelectorAll('[role="option"]'));
        const grps = Array.prototype.slice.call(pop.querySelectorAll('.mmcb-grp'));
        const measured = opts.map(function (o) {
          return {
            text: String(o.textContent || '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 48),
            ratio: Math.round(R(o) * 100) / 100
          };
        });
        const groups = grps.map(function (g) {
          return {
            text: String(g.textContent || '')
              .trim()
              .slice(0, 40),
            ratio: Math.round(R(g) * 100) / 100
          };
        });
        const dark = document.body.classList.contains('dark-mode');
        return {
          dark,
          theme: document.documentElement.getAttribute('data-theme'),
          n: measured.length,
          groups: groups,
          opts: measured,
          worstOpt: measured.reduce(function (m, o) {
            return m === null || o.ratio < m ? o.ratio : m;
          }, null),
          worstGrp: groups.reduce(function (m, g) {
            return m === null || g.ratio < m ? g.ratio : m;
          }, null),
          popBg: getComputedStyle(pop).backgroundColor
        };
      });

      check(
        'T-DARK [' + mode + '] the list opens with options and family headings',
        probe.n >= 40 && probe.groups.length >= 5,
        { n: probe.n, groups: probe.groups.length }
      );
      check(
        'T-DARK [' +
          mode +
          '] every option reads at 4.5:1 or better (' +
          probe.worstOpt +
          ':1 worst)',
        probe.worstOpt !== null && probe.worstOpt >= 4.5,
        probe.opts.filter(o => o.ratio < 4.5).slice(0, 6)
      );
      check(
        'T-DARK [' +
          mode +
          '] every family heading reads at 4.5:1 or better (' +
          probe.worstGrp +
          ':1 worst)',
        probe.worstGrp !== null && probe.worstGrp >= 4.5,
        probe.groups.filter(g => g.ratio < 4.5).slice(0, 6)
      );
      check(
        'T-DARK [' + mode + '] the list paints solid (no transparent card over the page)',
        /^rgba?\([^)]*\)$/.test(probe.popBg) && !/rgba\([^)]*,\s*0(\.0*)?\)$/.test(probe.popBg),
        probe.popBg
      );
      if (mode === 'light' || mode === 'dark') {
        check(
          'T-DARK [' + mode + '] dark mode agrees with the stored theme',
          (mode === 'dark') === probe.dark,
          { dark: probe.dark, theme: probe.theme }
        );
      }

      // Evidence: one screenshot per theme, of the family list.
      try {
        await page.screenshot({ path: path.join(SHOTS, 'families-' + mode + '.png') });
      } catch (e) {
        /* evidence only */
      }

      // The keyboard contract: type to filter, enter picks, escape closes.
      // Blur first, then click: the module selects the label on focus so the
      // first keystroke replaces it (the flow a person gets), and a click on an
      // already-focused input would skip that focus step.
      await page.keyboard.press('Escape');
      await page.evaluate(() => {
        if (document.activeElement && document.activeElement.blur) {
          document.activeElement.blur();
        }
      });
      await page.click('.mmcb[data-for="calc-work"] .mmcb-input');
      await page.keyboard.type('block');
      const filtered = await page.evaluate(() => {
        const pop = document.querySelector('.mmcb[data-for="calc-work"] .mmcb-pop');
        return Array.prototype.slice
          .call(pop.querySelectorAll('[role="option"]'))
          .map(o => String(o.textContent || '').toLowerCase());
      });
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      const picked = await page.evaluate(() => {
        const sel = document.getElementById('calc-work');
        const pop = document.querySelector('.mmcb[data-for="calc-work"] .mmcb-pop');
        return { value: sel.value, closed: pop.hidden, label: sel.__mmcb.input.value };
      });
      check(
        'T-DARK [' + mode + '] typing filters the list, Enter picks, the popup closes',
        filtered.length > 0 &&
          filtered.every(t => t.indexOf('block') > -1) &&
          picked.closed &&
          picked.label.length > 0,
        { nodes: filtered.length, picked }
      );
      check('T-DARK [' + mode + '] no uncaught page error', errors.length === 0, errors);
      await page.context().close();
    }

    // ------------------------------------------------------------------
    // T-ROWS: setting rows are switches with drawers.
    // ------------------------------------------------------------------
    {
      const { page, errors } = await open('light', false);

      const bare = await page.evaluate(() => {
        return Array.prototype.slice
          .call(document.querySelectorAll('input[type="checkbox"]'))
          .filter(function (cb) {
            if (cb.closest('.set-row') && cb.closest('.tgl')) {
              return false;
            }
            // The Performance Mode switch is a top-bar control (PERF-1), not a
            // calculator SETTING: it owns no fields, so it is out of UI-2's
            // scope by design. The exception is NAMED, not "anything inside
            // .bcp-perf" - a blanket class exemption would excuse the next bare
            // checkbox someone drops in that wrapper. The arm below proves the
            // one it names is a real switch.
            if (cb.id === 'perf-tgl' && cb.getAttribute('data-action') === 'tglPerfMode') {
              return false;
            }
            return true;
          })
          .map(function (cb) {
            return (cb.id || '(no id)') + ' in .' + (cb.parentElement.className || '?');
          });
      });
      // The Performance Mode switch lives in the top bar by design (a .tgl is
      // the app's control; the row pattern is for settings that own fields).
      check(
        'T-ROWS no bare checkbox remains: every one is a .tgl inside a .set-row',
        bare.length === 0,
        bare
      );

      // The named exception has to be a SWITCH, not a checkbox wearing a
      // wrapper: one input, visually hidden, a painted track with a knob that
      // moves, and a label click that flips it. Measured in both states.
      const readPerf = () =>
        page.evaluate(() => {
          const cb = document.getElementById('perf-tgl');
          const track = cb ? cb.nextElementSibling : null;
          const knob = track ? getComputedStyle(track, '::before') : null;
          return {
            count: document.querySelectorAll('.bcp-perf input[type="checkbox"]').length,
            id: cb ? cb.id : null,
            action: cb ? cb.getAttribute('data-action') : null,
            aria: cb ? cb.getAttribute('aria-label') : null,
            checked: cb ? cb.checked : null,
            inputOpacity: cb ? getComputedStyle(cb).opacity : null,
            track:
              track && getComputedStyle(track).display !== 'none'
                ? {
                    w: Math.round(track.getBoundingClientRect().width),
                    h: Math.round(track.getBoundingClientRect().height),
                    bg: getComputedStyle(track).backgroundColor
                  }
                : null,
            knob: knob ? { w: knob.width, transform: knob.transform } : null
          };
        });
      const perfOff = await readPerf();
      await page.click('.bcp-perf');
      await delay(300);
      const perfOn = await readPerf();
      await page.click('.bcp-perf');
      await delay(300);
      const perfBack = await readPerf();
      check(
        'T-ROWS the Performance Mode exception is one named switch, visually hidden input over a painted track',
        perfOff.count === 1 &&
          perfOff.id === 'perf-tgl' &&
          perfOff.action === 'tglPerfMode' &&
          !!perfOff.aria &&
          perfOff.inputOpacity === '0' &&
          perfOff.track &&
          perfOff.track.w === 32 &&
          perfOff.track.h === 18 &&
          perfOff.track.bg !== 'rgba(0, 0, 0, 0)' &&
          perfOff.knob &&
          parseFloat(perfOff.knob.w) >= 12,
        { perfOff }
      );
      check(
        'T-ROWS clicking the switch flips it, recolours the track and moves the knob',
        perfOn.checked === true &&
          perfOn.track.bg !== perfOff.track.bg &&
          perfOn.knob.transform !== perfOff.knob.transform &&
          perfBack.checked === false &&
          perfBack.track.bg === perfOff.track.bg,
        { perfOff, perfOn, perfBack }
      );

      // The rows the directive names must exist.
      const rows = await page.evaluate(() =>
        Array.prototype.slice.call(document.querySelectorAll('.set-row')).map(r => ({
          id: r.id || '',
          name: (r.querySelector('.set-name') || {}).textContent || '',
          hasSwitch: !!r.querySelector('.tgl input[type="checkbox"]'),
          hasDrawer: !!r.querySelector('.set-more'),
          plain: r.classList.contains('is-plain'),
          hidden: r.hidden
        }))
      );
      const want = ['row-oncost', 'row-tax', 'row-labour', 'row-measured', 'row-sig'];
      const missing = want.filter(id => !rows.some(r => r.id === id));
      check(
        'T-ROWS the statutory, tax, labour-only, known-total and signature rows all exist',
        missing.length === 0,
        { missing, ids: rows.map(r => r.id) }
      );

      // Clicking the words (not the switch) toggles it.
      const toggle = await page.evaluate(async () => {
        const row = document.getElementById('row-labour');
        const cb = row.querySelector('input[type="checkbox"]');
        const before = cb.checked;
        row.querySelector('.set-name').click();
        const after = cb.checked;
        return { before, after };
      });
      check(
        'T-ROWS clicking the row text flips the switch',
        toggle.before !== toggle.after,
        toggle
      );

      // The drawer opens on the switch and closes with inert when off. The
      // "I know the total" row owns a real drawer (its quantity box), so it is
      // the honest subject for this test.
      const drawer = await page.evaluate(async () => {
        const row = document.getElementById('row-measured');
        const cb = row.querySelector('input[type="checkbox"]');
        const more = row.querySelector('.set-more');
        if (!cb.checked) {
          cb.click();
        }
        await new Promise(r => setTimeout(r, 350));
        const openH = more.getBoundingClientRect().height;
        const openInert = more.hasAttribute('inert');
        const openExpanded = cb.getAttribute('aria-expanded');
        cb.click();
        await new Promise(r => setTimeout(r, 400));
        const shutH = more.getBoundingClientRect().height;
        const shutInert = more.hasAttribute('inert');
        const shutExpanded = cb.getAttribute('aria-expanded');
        return { openH, openInert, openExpanded, shutH, shutInert, shutExpanded };
      });
      check(
        'T-ROWS the drawer opens with the switch and collapses when it is off',
        drawer.openH > 0 &&
          drawer.openInert === false &&
          drawer.openExpanded === 'true' &&
          drawer.shutH === 0 &&
          drawer.shutExpanded === 'false',
        drawer
      );
      check(
        'T-ROWS a closed drawer is inert, so its fields cannot be tabbed into',
        drawer.shutInert === true && drawer.openInert === false,
        drawer
      );

      // The statutory drawer: four editable parts, one read-only total.
      const parts = await page.evaluate(async () => {
        const cb = document.getElementById('calc-oncost-toggle');
        if (!cb.checked) {
          cb.click();
        }
        await new Promise(r => setTimeout(r, 120));
        const ids = ['nis', 'nht', 'edtax', 'heart'];
        function write(id, v) {
          const el = document.getElementById('calc-oncost-' + id);
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        write('nis', '4');
        write('nht', '3');
        write('edtax', '3.5');
        write('heart', '3');
        const pct = document.getElementById('calc-oncost-pct');
        const afterEdit = {
          pct: pct.value,
          label: (document.getElementById('calc-oncost-total') || {}).textContent
        };
        // Reset to the Jamaica defaults.
        document.querySelector('[data-action="calcOncostReset"]').click();
        const afterReset = {
          pct: pct.value,
          label: (document.getElementById('calc-oncost-total') || {}).textContent,
          nis: document.getElementById('calc-oncost-nis').value
        };
        return { afterEdit, afterReset };
      });
      check(
        'T-ROWS the four statutory parts sum into the one percent the engine reads',
        String(parts.afterEdit.pct) === '13.5' && /13\.5%/.test(parts.afterEdit.label),
        parts.afterEdit
      );
      check(
        'T-ROWS "Reset to defaults" restores the Jamaica stack and shows its total',
        /12\.5%/.test(parts.afterReset.label) &&
          parts.afterReset.nis === '3' &&
          (parts.afterReset.pct === '12.5' || parts.afterReset.pct === ''),
        parts.afterReset
      );

      // The tax switch IS the country choice - one state, two controls.
      const tax = await page.evaluate(async () => {
        const t = document.getElementById('calc-tax-toggle');
        const c = document.getElementById('calc-country');
        if (!t.checked) {
          t.click();
        }
        const on = { country: c.value, checked: t.checked };
        t.click();
        await new Promise(r => setTimeout(r, 60));
        const off = { country: c.value, checked: t.checked };
        t.click();
        await new Promise(r => setTimeout(r, 60));
        const back = { country: c.value, checked: t.checked };
        return { on, off, back };
      });
      check(
        'T-ROWS the tax switch is the country choice (off writes no-tax, on restores it)',
        tax.on.country === 'JM' &&
          tax.off.country === 'NONE' &&
          tax.off.checked === false &&
          tax.back.country === 'JM' &&
          tax.back.checked === true,
        tax
      );

      // Switching a row off returns the same estimate without its values.
      const maths = await page.evaluate(async () => {
        function pick(id, v) {
          const s = document.getElementById(id);
          s.value = v;
          s.dispatchEvent(new Event('change', { bubbles: true }));
        }
        function total() {
          const out = document.getElementById('calc-output');
          const t = String((out && out.textContent) || '').replace(/\s+/g, ' ');
          const i = t.toLowerCase().indexOf('estimated total');
          if (i === -1) {
            return null;
          }
          const m = t.slice(i).match(/([0-9][0-9,\.]*)/);
          return m ? parseInt(m[1].replace(/[^0-9]/g, ''), 10) : null;
        }
        pick('calc-work', 'custom');
        document.getElementById('calc-custom-name').value = 'Row test';
        document.getElementById('calc-custom-unit').value = 'day';
        document.getElementById('calc-custom-qty').value = '2';
        document.getElementById('calc-custom-rate').value = '10000';
        pick('calc-country', 'NONE');
        // On-cost ON at the documented 12.5%.
        const oc = document.getElementById('calc-oncost-toggle');
        if (!oc.checked) {
          oc.click();
        }
        await new Promise(r => setTimeout(r, 120));
        const pct = document.getElementById('calc-oncost-pct');
        const pctOn = pct.value;
        const withRow = total();
        // Off: the drawer keeps its numbers, the estimate loses the uplift.
        oc.click();
        await new Promise(r => setTimeout(r, 200));
        const pctOff = pct.value;
        const without = total();
        const kept = document.getElementById('calc-oncost-nis').value;
        return { pctOn, pctOff, withRow, without, kept };
      });
      check(
        'T-ROWS switching the statutory row off prices the estimate without it (values are kept, not deleted)',
        maths.pctOn === '12.5' &&
          maths.withRow === 22500 &&
          maths.without === 20000 &&
          maths.kept === '3',
        maths
      );

      check('T-ROWS no uncaught page error', errors.length === 0, errors);
      await page.context().close();
    }

    // ------------------------------------------------------------------
    // UI-3: the fine print lives in the guide's Notes tab.
    // ------------------------------------------------------------------
    {
      const { page, errors } = await open('light', false);
      const ui3 = await page.evaluate(() => {
        const notes = document.getElementById('calc-guide-panel-notes');
        const steps = document.getElementById('calc-guide-panel-steps');
        const tabs = document.querySelector('#calc-guide-card .bcp-tabs');
        const text = notes
          ? String(notes.textContent || '')
              .replace(/\s+/g, ' ')
              .trim()
          : '';
        return {
          ledeGone: !document.querySelector('.bcp-lede'),
          ledeLine: ((document.querySelector('.bcp-lede-line') || {}).textContent || '').trim(),
          text: text,
          notesHidden: notes ? notes.hidden : null,
          stepsHidden: steps ? steps.hidden : null,
          role: tabs ? tabs.getAttribute('role') : null,
          tabs: Array.prototype.slice
            .call(tabs ? tabs.querySelectorAll('[role="tab"]') : [])
            .map(t => ({
              id: t.id,
              controls: t.getAttribute('aria-controls'),
              selected: t.getAttribute('aria-selected'),
              tabindex: t.tabIndex
            })),
          panels: Array.prototype.slice
            .call(document.querySelectorAll('#calc-guide-card [role="tabpanel"]'))
            .map(p => ({ id: p.id, labelledby: p.getAttribute('aria-labelledby') }))
        };
      });
      check(
        'UI-3 the old lede paragraph is gone and one short line stands in its place',
        ui3.ledeGone && /Price a job in minutes/.test(ui3.ledeLine),
        { ledeGone: ui3.ledeGone, ledeLine: ui3.ledeLine }
      );

      const sentences = [
        'Pick a work item, enter the dimensions, choose your currency and country.',
        'Rates are planning-grade averages for early estimates, not quotes',
        'Dimensions can be typed in metric or imperial',
        'Tax rates are the standard national rates',
        'Everything runs on this device'
      ];
      const absent = sentences.filter(s => ui3.text.indexOf(s) === -1);
      check('UI-3 every moved sentence sits in Notes verbatim', absent.length === 0, absent);

      check(
        'UI-3 the card is a real tablist: tabs control panels, panels name their tab',
        ui3.role === 'tablist' &&
          ui3.tabs.length === 2 &&
          ui3.tabs.every(t => !!t.controls) &&
          ui3.panels.length === 2 &&
          ui3.panels.every(p => !!p.labelledby) &&
          ui3.tabs[0].selected === 'true' &&
          ui3.tabs[1].tabindex === -1,
        ui3
      );
      check(
        'UI-3 the card opens on Steps',
        ui3.stepsHidden === false && ui3.notesHidden === true,
        ui3
      );

      // Arrow keys move between tabs and take focus with them.
      await page.click('#calc-guide-tab-steps');
      await page.keyboard.press('ArrowRight');
      const right = await page.evaluate(() => ({
        selected: (document.getElementById('calc-guide-tab-notes') || {}).getAttribute
          ? document.getElementById('calc-guide-tab-notes').getAttribute('aria-selected')
          : null,
        focused: document.activeElement ? document.activeElement.id : '',
        notesHidden: document.getElementById('calc-guide-panel-notes').hidden,
        stepsHidden: document.getElementById('calc-guide-panel-steps').hidden
      }));
      check(
        'UI-3 ArrowRight switches to Notes, shows its panel and focuses its tab',
        right.selected === 'true' &&
          right.focused === 'calc-guide-tab-notes' &&
          right.notesHidden === false &&
          right.stepsHidden === true,
        right
      );
      await page.keyboard.press('Home');
      const home = await page.evaluate(() => ({
        selected: document.getElementById('calc-guide-tab-steps').getAttribute('aria-selected'),
        focused: document.activeElement ? document.activeElement.id : ''
      }));
      check(
        'UI-3 Home returns to Steps',
        home.selected === 'true' && home.focused === 'calc-guide-tab-steps',
        home
      );
      check('UI-3 no uncaught page error', errors.length === 0, errors);
      await page.context().close();
    }

    // ------------------------------------------------------------------
    // T-PERF-WIRE on the calculator.
    // ------------------------------------------------------------------
    {
      const { page, errors } = await open('light', true);
      const on = await page.evaluate(() => {
        const de = document.documentElement;
        const all = Array.prototype.slice.call(document.querySelectorAll('*'));
        const blurred = all.filter(function (el) {
          const cs = getComputedStyle(el);
          const bf = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
          return bf && bf !== 'none';
        });
        const canvases = document.querySelectorAll('canvas').length;
        const glass = window.MMGR && window.MMGR.Glass ? window.MMGR.Glass.active() : false;
        const sw = document.querySelector('[data-action="tglPerfMode"]');
        return {
          attr: de.getAttribute('data-perf'),
          blurred: blurred.length,
          blurredSample: blurred.slice(0, 4).map(el => el.tagName + '.' + (el.className || '')),
          canvases,
          glass,
          switchChecked: sw ? sw.checked : null,
          stored: localStorage.getItem('mmgr_perf_mode'),
          solid: getComputedStyle(document.body).backgroundColor
        };
      });
      check(
        'T-PERF-WIRE the stored choice lands on <html data-perf> before first paint',
        on.attr === 'on' && on.stored === 'on',
        on
      );
      check('T-PERF-WIRE nothing keeps a backdrop-filter in Performance Mode', on.blurred === 0, {
        count: on.blurred,
        sample: on.blurredSample
      });
      check(
        'T-PERF-WIRE the shader never mounts (no canvas, no active WebGL engine)',
        on.glass === false && on.canvases === 0,
        { glass: on.glass, canvases: on.canvases }
      );
      check(
        'T-PERF-WIRE the top-bar switch reports the real state',
        on.switchChecked === true,
        on.switchChecked
      );

      // Flip it off in the page and assert the effects come back without a reload.
      await page.click('.bcp-perf');
      await delay(700);
      const off = await page.evaluate(() => {
        const de = document.documentElement;
        const all = Array.prototype.slice.call(document.querySelectorAll('*'));
        const blurred = all.filter(function (el) {
          const cs = getComputedStyle(el);
          const bf = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
          return bf && bf !== 'none';
        });
        return {
          attr: de.getAttribute('data-perf'),
          blurred: blurred.length,
          stored: localStorage.getItem('mmgr_perf_mode'),
          switchChecked: (document.querySelector('[data-action="tglPerfMode"]') || {}).checked
        };
      });
      check(
        'T-PERF-WIRE switching it off restores the effects without a reload',
        off.attr === 'off' &&
          off.blurred > 0 &&
          off.stored === 'off' &&
          off.switchChecked === false,
        off
      );
      check('T-PERF-WIRE no uncaught page error', errors.length === 0, errors);
      await page.context().close();
    }

    // ------------------------------------------------------------------
    // UI-4: the calculator bar mirrors the app bar - measured, both themes,
    // on the four properties the directive names (height, radius,
    // background, shadow) plus the row gap.
    //
    // "Height" is the one property that needed an honest reading: the app bar
    // (body.db-page .top) has no fixed height - it is a hero panel with an h1
    // in it. What it does fix is the band its OWN controls sit in: 56px of
    // padding-top, commented there as "top row = corner controls - h1 sits
    // below". So 56px is the shared number: the calculator bar is that band
    // exactly (7px + 40px controls + 7px + a 1px border each side, border-box),
    // and the gate compares the app bar's reserved band against the calculator
    // bar's measured height.
    // ------------------------------------------------------------------
    {
      const measure = async (url, selector, theme, width) => {
        const ctx = await browser.newContext({ viewport: { width: width, height: 900 } });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String((e && e.message) || e).slice(0, 160)));
        await page.addInitScript(t => {
          try {
            localStorage.setItem('mmgr_theme', t);
            localStorage.removeItem('mmgr_perf_mode');
          } catch (e) {}
        }, theme);
        await page.goto(BASE + url, { waitUntil: 'load', timeout: 60000 });
        await page.waitForFunction(sel => !!document.querySelector(sel), selector, {
          timeout: 30000
        });
        await delay(300);
        const m = await page.evaluate(sel => {
          const el = document.querySelector(sel);
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const row = document.querySelector(sel + ' .db-hero-row');
          return {
            height: Math.round(r.height),
            width: Math.round(r.width),
            radius: cs.borderRadius,
            bgImage: cs.backgroundImage,
            bgColor: cs.backgroundColor,
            shadow: cs.boxShadow,
            gap: cs.gap,
            rowGap: row ? getComputedStyle(row).gap : null,
            paddingTop: cs.paddingTop,
            minHeight: cs.minHeight,
            backdrop: cs.backdropFilter || cs.webkitBackdropFilter || 'none'
          };
        }, selector);
        await ctx.close();
        return { m: m, errors: errors };
      };

      for (const theme of ['light', 'dark']) {
        const app = await measure('/app.html', '.top', theme, 1280);
        const calc = await measure('/calculator.html', '.bcp-top', theme, 1280);
        const tag = 'UI-4 (' + theme + ') ';
        check(
          tag + 'both bars load with no page error',
          app.errors.length === 0 && calc.errors.length === 0,
          { app: app.errors, calc: calc.errors }
        );
        check(
          tag + 'same radius, background and shadow as the app bar',
          app.m.radius === calc.m.radius &&
            (theme === 'light'
              ? app.m.bgImage === calc.m.bgImage
              : app.m.bgColor === calc.m.bgColor && app.m.bgColor !== 'rgba(0, 0, 0, 0)') &&
            app.m.shadow === calc.m.shadow,
          { app: app.m, calc: calc.m }
        );
        check(
          tag +
            'the bar is the app bar\u2019s 56px control band, 18px gap, glass blur on (functional layer)',
          calc.m.height === 56 &&
            calc.m.minHeight === '56px' &&
            app.m.paddingTop === '56px' &&
            calc.m.gap === '18px' &&
            app.m.rowGap === '18px' &&
            calc.m.backdrop &&
            calc.m.backdrop !== 'none' &&
            app.m.backdrop &&
            app.m.backdrop !== 'none',
          { calc: calc.m, appBand: app.m.paddingTop }
        );
      }

      // The 1px divider between title and actions, and the width cap that
      // stops the bar running as a long band on a wide window.
      const wide = await measure('/calculator.html', '.bcp-top', 'light', 1440);
      const divider = await (async () => {
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await ctx.newPage();
        await page.goto(BASE + '/calculator.html', { waitUntil: 'load', timeout: 60000 });
        await page.waitForFunction(() => !!document.querySelector('.bcp-top-right'), null, {
          timeout: 30000
        });
        const d = await page.evaluate(() => {
          const cs = getComputedStyle(document.querySelector('.bcp-top-right'));
          return { w: cs.borderLeftWidth, style: cs.borderLeftStyle, pad: cs.paddingLeft };
        });
        // The rate book button: mark + name at wide widths, mark alone on a
        // phone, so the label can never squeeze the bar.
        const labelWide = await page.evaluate(() => {
          const t = document.querySelector('.bcp-ratebook-text');
          const b = document.querySelector('.bcp-ratebook');
          return {
            w: t ? Math.round(t.getBoundingClientRect().width) : 0,
            btn: b ? Math.round(b.getBoundingClientRect().width) : 0,
            clip: t ? getComputedStyle(t).clipPath : ''
          };
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await delay(250);
        const labelNarrow = await page.evaluate(() => {
          const t = document.querySelector('.bcp-ratebook-text');
          const b = document.querySelector('.bcp-ratebook');
          const ico = document.querySelector('.bcp-ratebook .ico');
          return {
            w: t ? Math.round(t.getBoundingClientRect().width) : 0,
            btn: b ? Math.round(b.getBoundingClientRect().width) : 0,
            ico: ico ? Math.round(ico.getBoundingClientRect().width) : 0
          };
        });
        await ctx.close();
        return { d: d, labelWide: labelWide, labelNarrow: labelNarrow };
      })();
      check(
        'UI-4 a 1px divider stands between the title and the actions',
        divider.d.w === '1px' && divider.d.style === 'solid',
        divider.d
      );
      check(
        'UI-4 at 1440 the bar is capped to the content column instead of running the window',
        wide.m.width <= 1080 && wide.errors.length === 0,
        wide.m
      );
      check(
        'UI-4 the rate book button reads mark + name wide, mark alone on a phone',
        divider.labelWide.w > 60 &&
          divider.labelWide.clip === 'none' &&
          divider.labelNarrow.w <= 1 &&
          divider.labelNarrow.ico >= 14 &&
          divider.labelNarrow.btn > 20,
        divider
      );

      // Performance Mode takes the blur AND the lift off this bar (UI-4 +
      // PERF-1). T-PERF-WIRE above proves no element keeps a backdrop-filter;
      // this pins the bar's own shadow to the flat one Performance Mode sets.
      const perfCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const perfPage = await perfCtx.newPage();
      await perfPage.addInitScript(() => {
        try {
          localStorage.setItem('mmgr_theme', 'light');
          localStorage.setItem('mmgr_perf_mode', 'on');
        } catch (e) {}
      });
      await perfPage.goto(BASE + '/calculator.html', { waitUntil: 'load', timeout: 60000 });
      await perfPage.waitForFunction(() => !!document.querySelector('.bcp-top'), null, {
        timeout: 30000
      });
      await delay(400);
      const perf = await perfPage.evaluate(() => {
        const cs = getComputedStyle(document.querySelector('.bcp-top'));
        return {
          perf: document.documentElement.getAttribute('data-perf'),
          backdrop: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
          shadow: cs.boxShadow
        };
      });
      await perfCtx.close();
      check(
        'UI-4 under Performance Mode the bar loses its blur and its lift',
        perf.perf === 'on' &&
          perf.backdrop === 'none' &&
          // Chrome serialises the colour first in a computed box-shadow.
          perf.shadow === 'rgba(0, 0, 0, 0.18) 0px 1px 2px 0px',
        perf
      );
    }
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
