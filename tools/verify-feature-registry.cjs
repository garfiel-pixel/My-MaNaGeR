/* ============================================================
   verify-feature-registry.cjs - T-05 registry gate
   ------------------------------------------------------------
   T-03 made js/marketing.js carry ONE `FEATURES` array. This gate
   proves the three surfaces still agree with it:
     - index.html's #features pool card ids == FEATURES cardIds
     - features.html's .feature block ids == FEATURES detail ids
     - no duplicate id anywhere, and PANEL_COUNT is derived from the
       panel:true entries (15).
   Static: node builtins only, no browser, no server.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const results = [];
function check(name, val, detail) {
  results.push({ name, val });
  console.log(
    (val ? 'PASS' : 'FAIL') +
      '  ' +
      name +
      (val ? '' : '   <-- ' + JSON.stringify(detail === undefined ? null : detail))
  );
}

function loadRegistry() {
  const src = fs.readFileSync(path.join(ROOT, 'js/marketing.js'), 'utf8');
  const start = src.indexOf('var FEATURES = [');
  const navStart = src.indexOf('var NAV_DD = {');
  if (start < 0 || navStart < 0) {
    throw new Error('FEATURES or NAV_DD not found in js/marketing.js');
  }
  const navEnd = src.indexOf('\n  };', navStart) + 5;
  const snippet = src.slice(start, navEnd);
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(snippet, sandbox);
  return { FEATURES: sandbox.FEATURES, NAV_DD: sandbox.NAV_DD, src };
}

let registry;
try {
  registry = loadRegistry();
} catch (e) {
  console.log('FAIL  could not evaluate the registry: ' + e.message);
  process.exit(1);
}
const FEATURES = registry.FEATURES;

const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const featuresHtml = fs.readFileSync(path.join(ROOT, 'features.html'), 'utf8');

// The bento pool is the authored card list; slots are clones moved by JS.
const poolStart = indexHtml.indexOf('data-bento-pool');
const poolEnd = poolStart < 0 ? -1 : indexHtml.indexOf('</section>', poolStart);
const pool = poolStart < 0 ? '' : indexHtml.slice(poolStart, poolEnd);
const indexCards = [...pool.matchAll(/<article class="fcard"[^>]*id="([^"]+)"/g)].map(m => m[1]);
const detailIds = [...featuresHtml.matchAll(/<div class="feature" id="([^"]+)"/g)].map(m => m[1]);

function sorted(a) {
  return a.slice().sort();
}
function dupes(a) {
  const seen = new Set();
  const out = [];
  for (const v of a) {
    if (seen.has(v)) {
      out.push(v);
    }
    seen.add(v);
  }
  return out;
}

check('registry: FEATURES is a non-empty array', Array.isArray(FEATURES) && FEATURES.length > 0, {
  length: FEATURES && FEATURES.length
});
check(
  'registry: every FEATURES entry has a unique id',
  dupes(FEATURES.map(f => f.id)).length === 0,
  dupes(FEATURES.map(f => f.id))
);
const cardIds = FEATURES.filter(f => f.cardId).map(f => f.cardId);
check('registry: cardId is unique', dupes(cardIds).length === 0, dupes(cardIds));
check(
  'registry: index.html has no duplicate card ids',
  dupes(indexCards).length === 0,
  dupes(indexCards)
);
check(
  'registry: features.html has no duplicate block ids',
  dupes(detailIds).length === 0,
  dupes(detailIds)
);

// Card parity: every landing card has a registry entry and every registry
// cardId has a landing card. Order is not the contract (T-06 inserts f-mcp
// after f-ai while the connector's registry entry can sit with its siblings).
check(
  'registry: index.html cards == FEATURES cardIds',
  JSON.stringify(sorted(indexCards)) === JSON.stringify(sorted(cardIds)),
  { index: sorted(indexCards), registry: sorted(cardIds) }
);

// Detail parity: every features.html block is registered with detail:true and
// every detail:true entry has a block.
const detailRegistered = FEATURES.filter(f => f.detail).map(f => f.id);
check(
  'registry: features.html blocks == FEATURES detail ids',
  JSON.stringify(sorted(detailIds)) === JSON.stringify(sorted(detailRegistered)),
  { page: sorted(detailIds), registry: sorted(detailRegistered) }
);

// PANEL_COUNT is derived, and the product count is still 15.
const panelCount = FEATURES.filter(f => f.panel).length;
check('registry: PANEL_COUNT is 15', panelCount === 15, { panelCount });
check(
  'registry: PANEL_COUNT is derived from FEATURES',
  /var PANEL_COUNT = FEATURES\.filter\(function \(f\) \{[\s\S]*?return f\.panel;[\s\S]*?\}\)\.length/.test(
    registry.src
  ),
  null
);
check(
  'registry: window.MMGR_PANEL_COUNT is exposed',
  /window\.MMGR_PANEL_COUNT = PANEL_COUNT;/.test(registry.src),
  null
);

const passed = results.filter(r => r.val).length;
console.log('=== FEATURE REGISTRY: ' + passed + '/' + results.length + ' ===');
if (passed !== results.length) {
  process.exitCode = 1;
}
