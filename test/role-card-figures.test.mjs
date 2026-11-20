/* ============================================================
   test/role-card-figures.test.mjs
   ------------------------------------------------------------
   Close-out Step 3f. The four Built For role cards were reported
   with two defects: the role title showed twice when a card was
   open (once in the button, once in the detail), and the figures
   did not match the owner's pose directions (hard hat vs fedora,
   visible gold rim, readable laptop, distinct hi-vis vest, suit).

   These are source-level assertions so they fail the moment a
   refinement is dropped. Runtime budgets (triangles, JS size,
   SVG fallback, one-open-at-a-time) stay governed by
   tools/qa-landing-motion.cjs C3.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const rolesJs = readFileSync(join(ROOT, 'js', 'marketing-roles.js'), 'utf8');
const css = readFileSync(join(ROOT, 'css', 'marketing.css'), 'utf8');

function roleBlock(role) {
  const start = html.indexOf('data-role="' + role + '"');
  assert.notEqual(start, -1, role + ' card exists');
  const next = html.indexOf('data-role="', start + 12);
  return html.slice(start, next === -1 ? html.length : next);
}

test('an open card shows the role title once', () => {
  // The button keeps a <b> title for the collapsed card; the detail panel has
  // its own .role-name title. While open the button title must be hidden so
  // the name is not printed twice.
  assert.match(
    css,
    /\.role-card\.is-open\s+\.role-btn\s*>\s*b[^}]*display\s*:\s*none/,
    'CSS hides the button <b> title while the card is open'
  );
});

test('the 3D hats read as hard hats, not fedoras', () => {
  assert.match(
    rolesJs,
    /SphereGeometry\([^)]*Math\.PI\s*\/\s*2/,
    'the hard-hat dome is a hemisphere, not a straight cylinder crown'
  );
  assert.match(rolesJs, /\bpeak\b/i, 'the hard hat has a short forward peak/brim');
});

test('the gold rim light is visible on the SVG fallback', () => {
  assert.match(
    css,
    /\.role-svg[^{}]*\{[^}]*stroke\s*:\s*rgba\(var\(--gold-rgb\)/,
    'SVG silhouettes carry a gold rim stroke, not only a faint shadow'
  );
});

test('the four poses match the owner direction (3D build)', () => {
  assert.match(rolesJs, /\blapel/i, 'the project manager has a suit lapel');
  assert.match(rolesJs, /\bvest\b/i, 'the superintendent has a distinct vest material');
  assert.match(rolesJs, /\bscreen\b/i, 'the general contractor laptop has a readable screen');
  assert.match(rolesJs, /\btoolbelt|belt\b/i, 'the trade lead has a tool belt');
  assert.match(rolesJs, /\blevel\b/i, 'the trade lead holds a level');
});

test('the four SVG fallbacks carry the same props and hard hats', () => {
  const pm = roleBlock('pm');
  const gc = roleBlock('gc');
  const superCard = roleBlock('super');
  const sub = roleBlock('sub');

  assert.match(pm, /data-prop="tablet"/, 'PM fallback holds a tablet');
  assert.match(pm, /data-prop="lapels"/, 'PM fallback wears a suit');
  assert.match(gc, /data-prop="laptop"/, 'GC fallback has a laptop');
  assert.match(gc, /data-prop="hardhat"/, 'GC fallback wears a hard hat');
  assert.match(superCard, /data-prop="clipboard"/, 'Super fallback has a clipboard');
  assert.match(superCard, /data-prop="vest"/, 'Super fallback has a hi-vis vest');
  assert.match(superCard, /data-prop="hardhat"/, 'Super fallback wears a hard hat');
  assert.match(sub, /data-prop="level"/, 'Trade lead fallback holds a level');
  assert.match(sub, /data-prop="belt"/, 'Trade lead fallback has a tool belt');
  assert.match(sub, /data-prop="hardhat"/, 'Trade lead fallback wears a hard hat');
});

test('the budgets are unchanged', () => {
  assert.match(rolesJs, /TRI_BUDGET\s*=\s*1500\b/, 'triangle budget stays 1500');
  assert.match(rolesJs, /MAX_DPR\s*=\s*1\.5\b/, 'device pixel ratio stays capped at 1.5');
  assert.equal(
    (html.match(/class="role-svg"/g) || []).length,
    4,
    'four inline SVG fallbacks remain'
  );
});
