#!/usr/bin/env node
/**
 * verify-delegate-gate.cjs
 * CI gate: flags any function name that exists in BOTH js/mmgr-app.js
 * AND js/app/*.js where the monolith version is NOT a one-line delegate.
 * Prevents the recurring extract-and-forget-to-delegate bug.
 * Exit 1 = violations found. Exit 0 = all clean.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const MONOLITH = path.resolve(__dirname, '..', 'js', 'mmgr-app.js');
const SPLIT_DIR = path.resolve(__dirname, '..', 'js', 'app');
const SPLIT_FILES = fs.readdirSync(SPLIT_DIR).filter(function(f) { return f.endsWith('.js'); }).map(function(f) { return path.join(SPLIT_DIR, f); });

function extractFunctions(filePath) {
  var content = fs.readFileSync(filePath, 'utf8');
  var lines = content.split('\n');
  var fns = new Map();
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(/(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:function|\())/);
    if (!m) continue;
    var name = m[1] || m[2];
    if (!name || name.length < 3) continue;
    var braceCount = 0, bodyStarted = false, bodyLines = 0;
    for (var j = i; j < Math.min(i + 30, lines.length); j++) {
      for (var ci = 0; ci < lines[j].length; ci++) {
        if (lines[j][ci] === '{') { braceCount++; bodyStarted = true; }
        if (lines[j][ci] === '}') braceCount--;
      }
      bodyLines++;
      if (bodyStarted && braceCount <= 0) break;
    }
    fns.set(name, { line: i + 1, bodyLines: bodyLines });
  }
  return fns;
}

function isDelegateBody(filePath, fnName) {
  var content = fs.readFileSync(filePath, 'utf8');
  var re = new RegExp('function\\s+' + fnName + '\\s*\\([^)]*\\)\\s*\\{([\\s\\S]+?)\\}');
  var m = content.match(re);
  if (!m) return false;
  var body = m[1].trim();
  var lineCount = body.split('\n').length;
  if (lineCount > 3) return false;
  if (/if\s*\(.*\)\s*\{?\s*(ns|window\.MMGR|MMGR|this)\.\w+\.\w+/.test(body)) return true;
  if (/return\s+(ns|window\.MMGR|MMGR|this)\.\w+/.test(body)) return true;
  if (/return\s+(true|false|null|undefined|\d+)/.test(body)) return true;
  if (/\(ns|window\.MMGR|MMGR\)\.\w+\.\w+/.test(body)) return true;
  return false;
}

var monolithFns = extractFunctions(MONOLITH);
var splitFns = new Map();
SPLIT_FILES.forEach(function(f) {
  var fns = extractFunctions(f);
  fns.forEach(function(info, name) {
    splitFns.set(name, { line: info.line, bodyLines: info.bodyLines, file: path.basename(f) });
  });
});

var violations = [];
splitFns.forEach(function(splitInfo, name) {
  if (monolithFns.has(name)) {
    var monoInfo = monolithFns.get(name);
    if (!isDelegateBody(MONOLITH, name)) {
      violations.push({ name: name, monolithLine: monoInfo.line, monolithBodyLines: monoInfo.bodyLines, splitFile: splitInfo.file, splitLine: splitInfo.line });
    }
  }
});

if (violations.length === 0) {
  console.log('[verify-delegate-gate] OK -- no monolith functions duplicate split-module implementations.');
  process.exit(0);
}
console.error('[verify-delegate-gate] FAIL -- ' + violations.length + ' function(s) in BOTH monolith and split without delegation:\n');
violations.forEach(function(v) {
  console.error('  ' + v.name + ':');
  console.error('    monolith: js/mmgr-app.js:' + v.monolithLine + ' (' + v.monolithBodyLines + ' body lines)');
  console.error('    split:    js/app/' + v.splitFile + ':' + v.splitLine);
});
console.error('\nFix: replace monolith body with a one-line delegate to the split module.');
process.exit(1);
