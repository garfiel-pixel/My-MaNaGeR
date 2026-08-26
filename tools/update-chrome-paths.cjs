#!/usr/bin/env node
/* Batch update: replace hardcoded Chrome paths with chrome-launcher.cjs */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const scripts = [
  'qa-ai-visual.cjs', 'qa-ai.cjs', 'qa-drive-smoke.cjs', 'qa-focus.cjs',
  'qa-glass-visual.cjs', 'qa-glass.cjs', 'qa-oauth.cjs', 'qa-obs-verify.cjs',
  'qa-r3.cjs', 'qa-restore-verify.cjs', 'qa-rhythm.cjs', 'qa-sync.cjs',
  'qa-typing.cjs', 'qa-v11.cjs', 'qa-voice.cjs',
  'tools/qa-ai-polish.cjs', 'tools/qa-cloud-phase1.cjs', 'tools/qa-cloud-phase2.cjs',
  'tools/qa-market-features.cjs',
  'tools/verify-cloud-autosave-signin.cjs', 'tools/verify-controls-admin.cjs',
  'tools/verify-dynamic-labels.cjs', 'tools/verify-gates-themes.cjs',
  'tools/verify-glass-preview-cdp.cjs', 'tools/verify-theme-cdp.cjs'
];

let updated = 0;

for (const rel of scripts) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;

  let content = fs.readFileSync(abs, 'utf8');

  // Check if already has the require
  if (content.includes("require('./tools/chrome-launcher") || content.includes("require('./chrome-launcher")) {
    console.log('SKIP (already updated): ' + rel);
    continue;
  }

  const requirePath = rel.startsWith('tools/') ? './chrome-launcher.cjs' : './tools/chrome-launcher.cjs';

  // Remove all CHROME/PORT/BASE lines (various patterns)
  const lines = content.split('\n');
  const newLines = [];
  let chromeFound = false;
  let addedRequire = false;

  for (const line of lines) {
    const isChromeLine = /const CHROME\s*=\s*['"]C:/.test(line);
    const isPortLine = /^const PORT\s*=\s*\d+/.test(line);
    const isBaseLine = /^const BASE\s*=\s*['"]http:/.test(line);

    if (isChromeLine) {
      chromeFound = true;
      if (!addedRequire) {
        newLines.push("const { chromePath: CHROME, BASE, DEBUG_PORT: PORT } = require('" + requirePath + "');");
        addedRequire = true;
      }
      continue; // skip CHROME line
    }

    // Remove PORT/BASE only if they were near a CHROME line (within 3 lines)
    if ((isPortLine || isBaseLine) && chromeFound && !addedRequire) {
      continue; // skip - already covered by require
    }

    // If PORT/BASE appear after the require was added, remove them
    if ((isPortLine || isBaseLine) && addedRequire) {
      continue; // skip - already in require
    }

    newLines.push(line);
  }

  if (chromeFound) {
    fs.writeFileSync(abs, newLines.join('\n'), 'utf8');
    console.log('UPDATED: ' + rel);
    updated++;
  } else {
    console.log('SKIP (no CHROME): ' + rel);
  }
}

console.log('\nDone: ' + updated + ' updated');
