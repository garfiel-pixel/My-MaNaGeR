/* OWNER 2026-11-22: paid tiers get a warm, directive assistant; the free
   tier keeps the strict grounded-only prompt. Loads the REAL js module in a
   vm sandbox (same pattern as the other model tests), then proves the
   mmgr-ai.js wiring points all three system-prompt sites at the selector. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const sandbox = { window: {}, console };
sandbox.window.MMGR = {};
vm.createContext(sandbox);
vm.runInContext(read('js/mmgr-ai-persona.js'), sandbox);
const P = sandbox.window.MMGR.AiPersona;

test('persona module exports the selector and both prompts', () => {
  assert.ok(P, 'AiPersona attached to MMGR');
  assert.equal(typeof P.systemPrompt, 'function');
  assert.equal(typeof P.isPaidTier, 'function');
  assert.match(P.FREE_SYSTEM_PROMPT, /grounded ONLY/);
  assert.match(P.FREE_SYSTEM_PROMPT, /not in data/);
});

test('free tier keeps the strict, cold prompt (limited AI)', () => {
  const p = P.systemPrompt('free');
  assert.equal(p, P.FREE_SYSTEM_PROMPT);
  assert.match(p, /grounded ONLY/);
  assert.match(p, /not in data/);
  assert.doesNotMatch(p, /left sidebar/);
});

test('unknown and empty tiers also fall back to strict, never to warm', () => {
  for (const t of ['', undefined, null, 'anonymous', 'FREE', 'basic']) {
    assert.equal(P.systemPrompt(t), P.FREE_SYSTEM_PROMPT, String(t));
  }
});

test('every paid tier gets the warm, directive persona', () => {
  for (const t of P.PAID_TIERS) {
    const p = P.systemPrompt(t);
    assert.equal(p, P.PAID_SYSTEM_PROMPT, t);
    assert.notEqual(p, P.FREE_SYSTEM_PROMPT, t);
    assert.match(p, /warm, direct and genuinely helpful/, t);
    assert.match(p, /Open Budget in the left sidebar/, t);
    assert.doesNotMatch(p, /say "not in data" explicitly/, t);
  }
});

test('tier matching is case-insensitive and trims whitespace', () => {
  assert.equal(P.isPaidTier('Company'), true);
  assert.equal(P.isPaidTier(' enterprise '), true);
  assert.equal(P.isPaidTier('free'), false);
});

test('the paid prompt still grounds project facts and names real areas', () => {
  assert.match(P.PAID_SYSTEM_PROMPT, /grounded ONLY in the project data below/);
  assert.match(P.PAID_SYSTEM_PROMPT, /Never invent a figure, date, name or fact/);
  for (const area of ['Budget', 'WBS', 'Gantt', 'Risk / Issues', 'Resources']) {
    assert.match(P.PAID_SYSTEM_PROMPT, new RegExp(area.replace('/', '\\/')), area);
  }
});

test('mmgr-ai.js: all three system-prompt sites use the tier selector', () => {
  const ai = read('js/mmgr-ai.js');
  const sites = ai.match(/role: 'system', content: [^\n]+/g) || [];
  assert.equal(sites.length, 3, 'three prompt construction sites');
  sites.forEach(s => assert.match(s, /assistantSystemPrompt\(\)/, s));
  assert.doesNotMatch(ai, /role: 'system', content: CLOUD_SYSTEM_PROMPT/);
  assert.match(ai, /P\.systemPrompt\(tier\)/);
  assert.match(ai, /E && typeof E\.tier === 'function'/);
});

test('build.js loads the persona module after entitlements, before mmgr-ai', () => {
  const build = read('build.js');
  const ent = build.indexOf("'js/app/entitlements.js'");
  const persona = build.indexOf("'js/mmgr-ai-persona.js'");
  const ai = build.indexOf("'js/mmgr-ai.js'");
  assert.ok(ent > -1 && persona > -1 && ai > -1);
  assert.ok(ent < persona && persona < ai, 'load order: entitlements -> persona -> ai');
});
