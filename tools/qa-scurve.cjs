#!/usr/bin/env node
// tools/qa-scurve.cjs
// Regression gate for WS-2 item 2.3: the EVM S-curve drawing itself left to
// right on page load (owner 2026-10-05).
//
// This is the item that was planned and then silently dropped, so the gate
// exists to make sure it cannot be dropped again. The risk it guards against
// is specific and real: stroke-dasharray animation that does not cover the
// path length leaves the curve INVISIBLE, which is worse than no animation
// at all. So this asserts the dash length covers the geometry, that the
// animation is actually present and reaches dashoffset 0, and that a
// renderer ignoring SMIL still shows a finished curve.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8765';
let fails = 0;
function ok(label, cond, extra) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  [' + extra + ']' : ''));
  if (!cond) {
    fails++;
  }
}

// ---- ARM 1: the asset itself, read from disk ---------------------------
console.log('=== ARM 1: SVG geometry and fallback ===\n');
const svg = fs.readFileSync(path.join(ROOT, 'images', 'hero-evm-chart.svg'), 'utf8');

ok('the planned curve is addressable (#evm-planned)', /id="evm-planned"/.test(svg));
ok('the earned curve is addressable (#evm-earned)', /id="evm-earned"/.test(svg));

const paths = [...svg.matchAll(/points="([^"]+)"[\s\S]{0,400}?stroke-dasharray="(\d+)"/g)];
ok('both curves carry a dasharray', paths.length === 2, paths.length + ' found');
for (const m of paths) {
  const pts = m[1]
    .trim()
    .split(/\s+/)
    .map(s => s.split(',').map(Number));
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  const dash = Number(m[2]);
  ok(
    'dasharray ' + dash + ' covers the path length ' + Math.round(len),
    dash >= len,
    dash >= len ? '' : 'SHORT by ' + Math.round(len - dash) + ' -> curve would be invisible'
  );
}

// A renderer that ignores SMIL must still render a FINISHED curve, never a
// blank one: the resting stroke-dashoffset has to be 0.
const offsets = [...svg.matchAll(/stroke-dasharray="\d+"\s+stroke-dashoffset="(\d+)"/g)];
ok(
  'resting dashoffset is 0 (static fallback shows the finished curve)',
  offsets.length === 2 && offsets.every(m => m[1] === '0'),
  offsets.map(m => m[1]).join(',')
);

const anims = [...svg.matchAll(/<animate attributeName="stroke-dashoffset"[^>]*>/g)];
ok('both curves animate stroke-dashoffset', anims.length === 2, anims.length + ' found');
ok(
  'every animate freezes at its end state (fill="freeze")',
  anims.every(m => /fill="freeze"/.test(m[0]))
);
ok(
  'every animate lands on dashoffset 0',
  anims.every(m => /to="0"/.test(m[0]))
);

// The earned curve is the one with a dasharray already; make sure we did not
// destroy its original rendering intent.
ok('the earned curve keeps its own stroke width', /stroke="#F5EFE6" stroke-width="5"/.test(svg));
// 2026-10-30 (U-05): the gold ramp moved from the old amber #E8923A to the
// bullion token #D4AF37. This arm had drifted with the artwork, so it was
// asserting a hex the file no longer carries (an EXTENDED gate, so no CI run
// ever caught it). Re-baselined to the token the ramp now ships.
ok('the planned curve keeps its gold stroke', /stroke="#D4AF37"/i.test(svg));

// ---- ARM 2: in a real browser -----------------------------------------
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disk-cache-size=0'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 90)));

  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 });

  console.log('\n=== ARM 2: the animation runs in a real browser ===\n');

  // Load the SVG inline (as an <img> does internally) and watch the
  // computed dashoffset move, then settle at 0.
  const run = await page.evaluate(async () => {
    const res = await fetch('images/hero-evm-chart.svg');
    const text = await res.text();
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:900px;height:491px';
    host.innerHTML = text;
    document.body.appendChild(host);
    const read = () =>
      Array.from(host.querySelectorAll('polyline[id^=evm-]')).map(p => ({
        id: p.id,
        offset: parseFloat(getComputedStyle(p).strokeDashoffset),
        total: parseFloat(getComputedStyle(p).strokeDashoffset) + p.getTotalLength()
      }));
    const samples = [];
    for (let i = 0; i < 14; i++) {
      samples.push(read().map(s => s.offset));
      await new Promise(r => setTimeout(r, 200));
    }
    host.remove();
    return samples;
  });

  const planned = run.map(s => s[0]);
  const earned = run.map(s => s[1]);
  const plannedMoved = planned.some((v, i) => i > 0 && v !== planned[i - 1]);
  const earnedMoved = earned.some((v, i) => i > 0 && v !== earned[i - 1]);

  ok(
    'the planned curve animates (dashoffset changes over time)',
    plannedMoved,
    planned
      .slice(0, 5)
      .map(v => Math.round(v))
      .join(' -> ')
  );
  ok(
    'the earned curve animates too',
    earnedMoved,
    earned
      .slice(0, 5)
      .map(v => Math.round(v))
      .join(' -> ')
  );
  ok(
    'the planned curve settles fully drawn (offset ~0)',
    Math.abs(planned[planned.length - 1]) < 1,
    'final=' + planned[planned.length - 1].toFixed(2)
  );
  ok(
    'the earned curve settles fully drawn (offset ~0)',
    Math.abs(earned[earned.length - 1]) < 1,
    'final=' + earned[earned.length - 1].toFixed(2)
  );

  // U-08 (2026-10-30): the white hero mock cards were deleted from the page.
  // The EVM artwork file therefore no longer renders in the hero, but it is a
  // tracked asset with a byte-level contract, so this arm keeps guarding the
  // FILE and asserts the dead cards are not creeping back.
  const hero = await page.evaluate(() => {
    return {
      deadCards: document.querySelectorAll('.hero-card, .hero-cards').length,
      poster: !!document.querySelector('.hg-poster')
    };
  });
  ok('no white hero mock cards came back', hero.deadCards === 0, 'found ' + hero.deadCards);
  ok('the hero art is the globe poster', hero.poster === true);
  ok(
    'the EVM artwork file is still intact (earned + planned polylines present)',
    /stroke-dasharray/.test(svg) && /id="evm-earned"/.test(svg) && /id="evm-planned"/.test(svg),
    'svg bytes=' + svg.length
  );
  ok('zero page errors', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log('\n' + (fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'));
  process.exit(fails === 0 ? 0 : 1);
})();
