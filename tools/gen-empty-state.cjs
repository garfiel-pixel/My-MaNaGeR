#!/usr/bin/env node
/* ============================================================
   tools/gen-empty-state.cjs - generate src/cloud/empty-state.js
   ------------------------------------------------------------
   WHY (owner 2026-11-17): a project created through MCP has no
   cloud snapshot, so the launcher cannot open it and the admin
   panel shows a row that was never saved. The fix is to seed the
   snapshot at create time - and the ONLY honest source for "what
   an empty My MaNaGeR project looks like" is the app's own
   `State.getDefaultState()` in js/mmgr-state.js. Copying that
   shape by hand would drift on the next schema bump.

   This generator evaluates js/mmgr-state.js in a small sandbox,
   calls `getDefaultState()` and writes the literal to
   src/cloud/empty-state.js with a stable wrapper:

     emptyProjectState(projectId, name, now)

   `--check` regenerates in memory and exits 1 if the file on disk
   differs (wired into `npm run verify` as verify:empty-state), so a
   schema bump that forgets to re-run this fails the build.

   Usage: node tools/gen-empty-state.cjs [--check]
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'js', 'mmgr-state.js');
const OUT = path.join(ROOT, 'src', 'cloud', 'empty-state.js');

// Minimal browser shim: mmgr-state.js is an IIFE over window/document and
// touches storage + a few event APIs at load time.
function sandbox() {
  const store = {};
  const storage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: k => {
      delete store[k];
    },
    key: i => Object.keys(store)[i] || null,
    get length() {
      return Object.keys(store).length;
    }
  };
  const noop = () => {};
  const win = {
    addEventListener: noop,
    removeEventListener: noop,
    location: { href: 'http://localhost/' },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    navigator: { onLine: true },
    crypto: crypto.webcrypto
  };
  const doc = {
    addEventListener: noop,
    removeEventListener: noop,
    documentElement: {},
    body: { appendChild: noop, classList: { add: noop, remove: noop, toggle: noop } },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop, remove: noop }),
    visibilityState: 'visible'
  };
  const ctx = {
    window: win,
    document: doc,
    localStorage: storage,
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    navigator: win.navigator,
    crypto: win.crypto,
    console,
    CustomEvent: class {},
    Event: class {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: fn => fn(),
    performance: { now: () => Date.now() },
    fetch: () => Promise.reject(new Error('no network in the generator')),
    URL: { createObjectURL: () => '', revokeObjectURL: noop },
    Blob: class {},
    Date,
    JSON,
    Math,
    parseInt,
    parseFloat,
    isFinite,
    isNaN,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Set,
    Map,
    RegExp,
    Error,
    Promise
  };
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  return ctx;
}

function buildState() {
  const ctx = sandbox();
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx, { filename: SRC });
  const State = ctx.window.MMGR && ctx.window.MMGR.State;
  if (!State || typeof State.getDefaultState !== 'function') {
    throw new Error('js/mmgr-state.js did not expose State.getDefaultState');
  }
  const state = State.getDefaultState();
  if (!state || typeof state !== 'object') {
    throw new Error('getDefaultState() returned no object');
  }
  // The default carries a live `updatedAt`; the wrapper stamps the real time
  // at call time, so the generated literal must stay byte-stable.
  if (typeof state.updatedAt === 'string') {
    state.updatedAt = '';
  }
  if (typeof state.createdAt === 'string') {
    state.createdAt = '';
  }
  return { state, schemaVersion: State.SCHEMA_VERSION };
}

function render(state, schemaVersion) {
  const literal = JSON.stringify(state, null, 2)
    .split('\n')
    .map(line => '  ' + line)
    .join('\n')
    .trimStart();
  return `/* ============================================================
   My MaNaGeR - the empty project state (GENERATED)
   ============================================================
   DO NOT EDIT. Produced by tools/gen-empty-state.cjs from the app's
   own State.getDefaultState() in js/mmgr-state.js.

   Why it exists: a project created by the MCP server has no home
   device to save the first snapshot, so the launcher cannot open it
   and the admin panel sees a row that was never saved. Creating the
   row now seeds this snapshot, which is exactly what a fresh project
   on a device would have saved - so an MCP-created project opens,
   renders and syncs like any other.

   Keep it in sync: \`node tools/gen-empty-state.cjs\` after any schema
   bump; \`npm run verify:empty-state\` fails when the file is stale.
   ============================================================ */

export const EMPTY_STATE_SCHEMA = ${schemaVersion};

const BASE = ${literal};

export function emptyProjectState(projectId, name, now) {
  const state = JSON.parse(JSON.stringify(BASE));
  state.schemaVersion = EMPTY_STATE_SCHEMA;
  state.projectId = String(projectId || '');
  state.projectName = String(name || '');
  if (state.charter && typeof state.charter === 'object') {
    state.charter.name = String(name || '');
  }
  state.createdAt = now;
  state.updatedAt = now;
  state.revision = 1;
  return state;
}
`;
}

function main() {
  const check = process.argv.includes('--check');
  const { state, schemaVersion } = buildState();
  const text = render(state, schemaVersion);
  if (check) {
    let disk = '';
    try {
      disk = fs.readFileSync(OUT, 'utf8');
    } catch (e) {
      console.error('[gen-empty-state] MISSING ' + path.relative(ROOT, OUT));
      process.exit(1);
    }
    if (disk !== text) {
      console.error(
        '[gen-empty-state] STALE - run `node tools/gen-empty-state.cjs` (schema ' +
          schemaVersion +
          ')'
      );
      process.exit(1);
    }
    console.log('[gen-empty-state] in sync - schema ' + schemaVersion);
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log('[gen-empty-state] wrote src/cloud/empty-state.js (schema ' + schemaVersion + ')');
}

main();
