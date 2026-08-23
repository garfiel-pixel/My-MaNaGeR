#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const SKIP = ['node_modules', '.git', '_archive', '.agents'];
function walk(dir) {
  let files = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory() && !SKIP.includes(f.name)) files = files.concat(walk(full));
    else if (f.isFile() && f.name.endsWith('.js')) files.push(full);
  }
  return files;
}

const jsFiles = walk('js');
let totalReplacements = 0;
let filesChanged = 0;

for (const f of jsFiles) {
  let content = fs.readFileSync(f, 'utf8');
  const original = content;

  // Replace \u2014 (em-dash) with comma-space contextually
  // In template strings like "text \u2014 text" -> "text, text"
  // In placeholder like '\u2014' -> '-' (no-data placeholder)
  // In empty state like "\u2014" -> "-"
  
  // Count before
  const countBefore = (content.match(/\\u2014/g) || []).length + (content.match(/\\u2013/g) || []).length;

  // Replace \u2014 (em-dash) with a plain comma-space or dash depending on context
  // Most common: "X \u2014 Y" in strings -> "X, Y"
  // Placeholder: '\u2014' -> '-'
  content = content.replace(/\\u2014/g, (match, offset) => {
    // Check surrounding context
    const before = content.substring(Math.max(0, offset - 3), offset);
    const after = content.substring(offset + 6, offset + 9);
    
    // If it's a standalone placeholder like '\\u2014' or just "\\u2014" in a ternary
    // Replace with a simple dash
    if (before.match(/['"(|,]\s*$/) || after.match(/^\s*[')]|$/)) {
      return '-';
    }
    // Otherwise replace with comma-space (sentence connector)
    return ', ';
  });

  // Replace \u2013 (en-dash) similarly
  content = content.replace(/\\u2013/g, (match, offset) => {
    const before = content.substring(Math.max(0, offset - 3), offset);
    const after = content.substring(offset + 6, offset + 9);
    
    // Placeholder or range: keep as hyphen
    return '-';
  });

  if (content !== original) {
    const countAfter = (content.match(/\\u2014/g) || []).length + (content.match(/\\u2013/g) || []).length;
    const replaced = countBefore - countAfter;
    totalReplacements += replaced;
    filesChanged++;
    fs.writeFileSync(f, content, 'utf8');
    console.log(`Fixed: ${f} (${replaced} escape sequences replaced)`);
  }
}

console.log(`\nDone: ${filesChanged} files changed, ${totalReplacements} escape sequences removed`);
