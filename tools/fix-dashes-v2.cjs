#!/usr/bin/env node
/**
 * fix-dashes-v2.cjs — Remove ALL em-dashes (U+2014), en-dashes (U+2013),
 * and horizontal bars (U+2015) from served HTML and client JS files.
 * Replaces with plain text alternatives: comma, colon, or nothing as appropriate.
 */
const fs = require('fs');
const path = require('path');

const files = [];

// All served HTML files
for (const f of fs.readdirSync('.').filter(f => f.endsWith('.html'))) {
  files.push(f);
}

// All client JS files
function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory() && !['node_modules', '.git', '_archive', '.agents'].includes(f.name)) {
      walk(full);
    } else if (f.isFile() && f.name.endsWith('.js')) {
      files.push(full);
    }
  }
}
walk('js');

// Also the monolith reference file
const monolith = 'monolith html to reference from all features.html';
if (fs.existsSync(monolith)) files.push(monolith);

let totalReplacements = 0;
let filesChanged = 0;

for (const f of files) {
  let content = fs.readFileSync(f, 'utf8');
  const original = content;
  
  // Step 1: Replace em-dash and en-dash in user-visible text
  // Strategy: contextual replacement
  // - "X — Y" pattern (surrounded by spaces) → "X, Y" or "X: Y" depending on context
  // - "— " at start of sentence fragment → ": "
  // - " —" at end → "."  or remove
  // - Inside JS template literals / string literals that render to DOM
  // - The literal character '—' (U+2014) and '–' (U+2013)
  
  // Simple approach: replace all em/en-dashes with a space or comma contextually
  // Most common pattern in this codebase: "text — more text" or "text – more text"
  // Replace with "text, more text" or "text: more text"
  
  // First pass: em-dash (—) 
  // Pattern: word + space + em-dash + space + word → word + ", " + word
  // But we need to be smarter for strings like "At Risk — 5d over target"
  // or "Over Target — 5d over" → "Over Target (5d over)"
  
  // Generic replacement: " — " → ", "
  content = content.replace(/ \u2014 /g, ', ');
  // " —" at end of a string/line → remove or add period
  content = content.replace(/ \u2014(?=[`'"])/g, '');
  content = content.replace(/ \u2014$/gm, '');
  // "—" at start after space → ": "
  content = content.replace(/(?<=\s)\u2014(?=\s)/g, ':');
  // Lone em-dashes (no spaces around) — just remove
  content = content.replace(/\u2014/g, '');
  
  // Second pass: en-dash (–)
  content = content.replace(/ \u2013 /g, ', ');
  content = content.replace(/ \u2013$/gm, '');
  content = content.replace(/(?<=\s)\u2013(?=\s)/g, ':');
  // En-dash used as range separator in dates — keep as hyphen
  content = content.replace(/\u2013/g, '-');
  
  // Horizontal bar (U+2015)
  content = content.replace(/\u2015/g, '-');
  
  // Also catch any remaining dash-like characters
  // U+2012 (figure dash)
  content = content.replace(/\u2012/g, '-');
  // U+2010 (hyphen)
  // leave hyphens alone — they're normal
  
  if (content !== original) {
    const count = (original.match(/[\u2012-\u2015]/g) || []).length;
    totalReplacements += count;
    filesChanged++;
    fs.writeFileSync(f, content, 'utf8');
    console.log(`Fixed: ${f} (${count} dashes replaced)`);
  }
}

console.log(`\nDone: ${filesChanged} files changed, ${totalReplacements} dashes removed total`);
