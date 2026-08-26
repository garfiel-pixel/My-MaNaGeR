#!/usr/bin/env node
/* ============================================================
   verify-contrast.cjs — WCAG 2.2 AA contrast ratio checker
   ------------------------------------------------------------
   Extracts color values from css/mmgr.css and css/marketing.css,
   computes contrast ratios against their background tokens, and
   fails if any pair falls below the WCAG 2.2 AA minimum (4.5:1
   for normal text, 3:1 for large text / UI components).

   Usage: node tools/verify-contrast.cjs
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failures = 0;
let passes = 0;

/* ---- sRGB relative luminance (WCAG 2.x definition) ---- */
function sRGBtoLinear(c) {
  c = c / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r, g, b) {
  return 0.2126 * sRGBtoLinear(r) + 0.7152 * sRGBtoLinear(g) + 0.0722 * sRGBtoLinear(b);
}

function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1[0], rgb1[1], rgb1[2]);
  const l2 = relativeLuminance(rgb2[0], rgb2[1], rgb2[2]);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseHex(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
}

function parseRGB(str) {
  const m = str.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return null;
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
}

/* ---- Extract token colors from CSS ---- */
function extractTokens(cssContent) {
  const tokens = {};
  // Match both :root and body.dark-mode blocks
  const blocks = cssContent.match(/(:root|body\.dark-mode)\s*\{[^}]+\}/g) || [];
  for (const block of blocks) {
    const isDark = block.startsWith('body.dark-mode');
    const prefix = isDark ? 'dark.' : 'light.';
    const assignments = block.match(/--[a-zA-Z0-9-]+\s*:\s*[^;]+/g) || [];
    for (const a of assignments) {
      const m = a.match(/--([a-zA-Z0-9-]+)\s*:\s*(.+)/);
      if (!m) continue;
      const name = m[1];
      let val = m[2].trim();
      // Extract hex colors
      const hexMatch = val.match(/#([0-9a-fA-F]{3,8})\b/);
      if (hexMatch) {
        tokens[prefix + name] = parseHex(hexMatch[1]);
      }
      // Extract rgb(r,g,b) — strip alpha
      const rgbMatch = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (rgbMatch) {
        tokens[prefix + name] = [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])];
      }
    }
  }
  return tokens;
}

/* ---- Check contrast pairs ---- */
function checkContrast(label, fg, bg, minRatio) {
  if (!fg || !bg) return; // token not found
  const ratio = contrastRatio(fg, bg);
  const passed = ratio >= minRatio;
  if (passed) {
    passes++;
    console.log('  PASS: ' + label + ' — ' + ratio.toFixed(2) + ':1 (min ' + minRatio + ':1)');
  } else {
    failures++;
    console.log('  FAIL: ' + label + ' — ' + ratio.toFixed(2) + ':1 (min ' + minRatio + ':1)');
  }
}

/* ---- Main ---- */
console.log('WCAG 2.2 AA Contrast Checker\n');

for (const cssFile of ['css/mmgr.css', 'css/marketing.css']) {
  const absPath = path.join(ROOT, cssFile);
  if (!fs.existsSync(absPath)) { console.log('SKIP: ' + cssFile + ' not found'); continue; }

  const css = fs.readFileSync(absPath, 'utf8');
  const tokens = extractTokens(css);

  console.log(cssFile + ':');

  // Key contrast pairs to check (WCAG AA: 4.5:1 for body text, 3:1 for large/UI)
  const pairs = [
    // Light mode
    ['text on card', tokens['light.text'], tokens['light.card'], 4.5],
    ['text on canvas', tokens['light.text'], tokens['light.canvas'], 4.5],
    ['slate on card', tokens['light.slate'], tokens['light.card'], 4.5],
    ['gold on card', tokens['light.gold'], tokens['light.card'], 3.0],
    ['green on card', tokens['light.green'], tokens['light.card'], 3.0],
    ['danger on card', tokens['light.danger'], tokens['light.card'], 3.0],
    ['blue on card', tokens['light.blue'], tokens['light.card'], 3.0],
    // Dark mode
    ['dark: text on card', tokens['dark.text'], tokens['dark.card'], 4.5],
    ['dark: text on canvas', tokens['dark.text'], tokens['dark.canvas'], 4.5],
    ['dark: slate on card', tokens['dark.slate'], tokens['dark.card'], 4.5],
    ['dark: gold on card', tokens['dark.gold'], tokens['dark.card'], 3.0],
    ['dark: green on card', tokens['dark.green'], tokens['dark.card'], 3.0],
    ['dark: danger on card', tokens['dark.danger'], tokens['dark.card'], 3.0],
    ['dark: blue on card', tokens['dark.blue'], tokens['dark.card'], 3.0],
  ];

  for (const [label, fg, bg, min] of pairs) {
    if (!fg || !bg) {
      console.log('  SKIP: ' + label + ' (token not found)');
      continue;
    }
    checkContrast(label, fg, bg, min);
  }
  console.log('');
}

console.log('Results: ' + passes + ' passed, ' + failures + ' failed');
if (failures > 0) {
  console.log('\nWCAG CONTRAST CHECK FAILED — ' + failures + ' pair(s) below minimum');
  process.exit(1);
} else {
  console.log('\nAll contrast pairs pass WCAG 2.2 AA');
  process.exit(0);
}
