#!/usr/bin/env node
/**
 * fix-dashes.cjs — Replace em-dash (U+2014), en-dash (U+2013), and horizontal bar (U+2015)
 * with plain ASCII equivalents across all served HTML and JS files.
 *
 * Rules:
 *   –  (en-dash, U+2013)  → -  (hyphen-minus)  — ranges like "3-7 days"
 *   —  (em-dash, U+2014)  → , (comma-space) in natural text, - (hyphen) in titles/labels/placeholders
 *   ―  (horizontal bar, U+2015) → - (hyphen)
 *
 * Special cases handled:
 *   - `'—'` or `"—"` used as empty-value placeholder → keep as `-`
 *   - `\u2019` (right single quote) → `'`
 *   - HTML `&mdash;` / `&ndash;` entities → replaced with ASCII equivalents
 */
const fs = require('fs');
const path = require('path');

const HTML_FILES = [
  'index.html','features.html','about.html','contact.html','legal.html',
  'field-guide.html','reviews.html','admin.html','app.html','project.html',
  'projects.html','setup.html','signin.html','report-issue.html'
];

const JS_DIRS = ['js', 'js/app', 'js/render', 'js/cloud', 'src'];

function getAllJsFiles() {
  const files = [];
  for (const d of JS_DIRS) {
    try {
      for (const f of fs.readdirSync(d)) {
        if (f.endsWith('.js')) files.push(path.join(d, f));
      }
    } catch (e) {}
  }
  return files;
}

function replaceDashes(content) {
  let changed = false;
  const original = content;

  // 1. Replace HTML entities: &mdash; → ,  and  &ndash; → -
  content = content.replace(/&mdash;/g, ', ');
  content = content.replace(/&ndash;/g, '-');

  // 2. Replace en-dash (U+2013) with hyphen (for ranges)
  content = content.replace(/\u2013/g, '-');

  // 3. Replace horizontal bar (U+2015) with hyphen
  content = content.replace(/\u2015/g, '-');

  // 4. Replace em-dash (U+2014) — context-sensitive
  //    a) Standalone placeholder: "—" or '—"  or >—< → keep as -
  //    b) Between words in titles/labels (no space before) → comma-space
  //    c) After opening paren/sentence start → comma-space

  // First pass: standalone placeholder em-dashes (value placeholders like >—</div>)
  content = content.replace(/(\s)>—</g, '$1>-<');
  content = content.replace(/>\u2014</g, '>-<');
  content = content.replace(/"(\u2014)"/g, '"-"');
  content = content.replace(/'(\u2014)'/g, "'-'");

  // Second pass: remaining em-dashes in text → comma-space
  // This handles: "word—word" → "word, word"
  // and "word — word" → "word, word"
  content = content.replace(/\u2014/g, ', ');

  // 5. Clean up double spaces created by replacements (but not in <script> or attributes)
  // Only fix double spaces that aren't intentional
  content = content.replace(/,  +/g, ', ');

  // 6. Replace \u2019 (right single quote / curly apostrophe) with ASCII apostrophe
  content = content.replace(/\u2019/g, "'");

  // 7. Replace \u201C and \u201D (curly double quotes) with ASCII double quotes
  // Only in JS strings (careful not to break HTML attributes)
  // Actually, let's skip this — curly quotes in HTML are fine, just em/en dashes are the target

  if (content !== original) changed = true;
  return { content, changed };
}

let totalChanged = 0;
let totalFiles = 0;

// Process HTML files
for (const f of HTML_FILES) {
  if (!fs.existsSync(f)) continue;
  const content = fs.readFileSync(f, 'utf8');
  const result = replaceDashes(content);
  totalFiles++;
  if (result.changed) {
    fs.writeFileSync(f, result.content, 'utf8');
    const originalDashes = (content.match(/[\u2013\u2014\u2015]/g) || []).length;
    console.log(`  FIXED: ${f} (${originalDashes} dashes replaced)`);
    totalChanged++;
  } else {
    console.log(`  clean: ${f}`);
  }
}

// Process JS files
const jsFiles = getAllJsFiles();
for (const f of jsFiles) {
  const content = fs.readFileSync(f, 'utf8');
  const result = replaceDashes(content);
  totalFiles++;
  if (result.changed) {
    fs.writeFileSync(f, result.content, 'utf8');
    const originalDashes = (content.match(/[\u2013\u2014\u2015]/g) || []).length;
    console.log(`  FIXED: ${f} (${originalDashes} dashes replaced)`);
    totalChanged++;
  } else {
    console.log(`  clean: ${f}`);
  }
}

console.log(`\n=== Summary ===`);
console.log(`Files scanned: ${totalFiles}`);
console.log(`Files fixed: ${totalChanged}`);
