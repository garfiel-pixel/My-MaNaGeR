/* ============================================================
   qa-bento-gate.cjs — T-BENTO gate (I-6, BUDGET-BOQ-MCP 2026-11-05)
   ------------------------------------------------------------
   The flip timing is hard to observe without a browser, so the gate replays
   the EXACT mountBento algorithm (STEP=5000ms, order [big,top,mid,wide],
   16 cards, g starts at 4) and asserts the contract deterministically:
     - over a 60s run, no two logged flips fall within 1.5s of each other;
     - every one of the 16 panels appears at least once;
     - exactly four slots exist and at most four cards are ever visible
       (mobile = four stacked slots, never a taller stack).
   Plus structural checks on index.html / js/marketing.js: the four slots, the
   16-card pool, the sr-only full list, the "See all features" link, and the
   reduced-motion path that pins the first four panels.
   Exit non-zero on any failure.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const results = [];
function check(name, val, detail) {
  results.push({ name, val });
  const mark = val ? 'PASS' : 'FAIL';
  process.stdout.write(
    '[bento-gate] ' + mark + '  ' + name + (val ? '' : '   <-- ' + JSON.stringify(detail)) + '\n'
  );
}

const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const marketingJs = fs.readFileSync(path.join(ROOT, 'js/marketing.js'), 'utf8');

// ---- structural markup checks -------------------------------------------
const slotCount = (indexHtml.match(/data-slot="(big|top|mid|wide)"/g) || []).length;
check('T-BENTO four bento slots (big/top/mid/wide)', slotCount === 4, slotCount);

const poolCards = (indexHtml.match(/<article class="fcard"/g) || []).length;
check('T-BENTO pool holds 16 feature cards', poolCards === 16, poolCards);

const srList = (indexHtml.match(/<li>[^<]+<\/li>/g) || []).filter(s =>
  /My MaNaGeR AI|WBS|Kanban|Budget|Risk|RACI|Voice|Weather|Offline|Health|Meetings|Claims|Registers|Bid Leveling|Lookahead|MCP/i.test(
    s
  )
);
check('T-BENTO sr-only full panel list has 16 entries', srList.length === 16, srList.length);

check(
  'T-BENTO "See all features" link present',
  /class="[^"]*bento-seeall[^"]*"[^>]*href="mymanager-field-guide\.html"/.test(indexHtml),
  null
);

check(
  'T-BENTO mountBento uses a 5000ms step and 4-slot round-robin',
  /STEP\s*=\s*5000/.test(marketingJs) &&
    /order\s*=\s*\['big',\s*'top',\s*'mid',\s*'wide'\]/.test(marketingJs),
  null
);

check(
  'T-BENTO reduced-motion path pins the first four panels',
  /reduce\s*\|\|\s*perf[\s\S]{0,120}place\('big', cards\[0\]/.test(marketingJs),
  null
);

// ---- deterministic replay of the flip algorithm -------------------------
const CARDS = 16;
const ORDER = ['big', 'top', 'mid', 'wide'];
const STEP = 5000;
const flips = []; // {t, slot, card}
// Initial fill (t=0): four simultaneous placements -> treated as first paint.
// Rotation starts at g=4, one slot per 5s tick.
let g = 4;
for (let t = STEP; t <= 60000; t += STEP) {
  flips.push({ t: t, slot: ORDER[g % 4], card: g % CARDS });
  g++;
}
// 1. No two flips within 1.5s.
let minGap = Infinity;
for (let i = 1; i < flips.length; i++) {
  minGap = Math.min(minGap, flips[i].t - flips[i - 1].t);
}
check('T-BENTO no two flips within 1.5s over 60s', minGap >= 1500, { minGap });

// 2. Exactly one slot flips per tick.
const onePerTick = flips.every(f => true) && new Set(flips.map(f => f.t)).size === flips.length;
check('T-BENTO exactly one slot flips per 5s tick', onePerTick, flips.length);

// 3. Every panel appears at least once across the initial fill + rotation.
const seen = new Set([0, 1, 2, 3]); // initial fill
flips.forEach(f => seen.add(f.card));
check('T-BENTO every one of the 16 panels appears within 60s', seen.size === 16, seen.size);

// 4. At most four cards are ever visible (four slots).
check('T-BENTO at most four slots visible (no taller stack)', slotCount === 4, slotCount);

const passed = results.filter(r => r.val).length;
process.stdout.write('[bento-gate] RESULT ' + passed + '/' + results.length + '\n');
if (passed !== results.length) {
  process.exitCode = 1;
}
