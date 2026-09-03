#!/usr/bin/env node
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

function hashFolder(dir) {
  const files = [];
  function walk(d) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        walk(full);
      } else if (e.isFile()) {
        const relativePath = path.relative(dir, full).split(path.sep).join('/');
        const content = fs.readFileSync(full);
        files.push({ relativePath, content });
      }
    }
  }
  walk(dir);
  if (!files.length) return '';
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file.relativePath);
    const str = file.content.toString('utf8').replace(/\r\n/g, '\n');
    hash.update(Buffer.from(str));
  }
  return hash.digest('hex');
}

const lock = JSON.parse(fs.readFileSync('skills-lock.json', 'utf8'));
const skillsDir = path.join(__dirname, '..', '.agents/skills');
let updated = 0;

for (const [name, entry] of Object.entries(lock.skills || {})) {
  const skillDir = path.join(skillsDir, name);
  if (fs.existsSync(skillDir)) {
    const newHash = hashFolder(skillDir);
    const oldHash = entry.computedHash || entry.hash || '';
    if (newHash && oldHash !== newHash) {
      console.log('Updating ' + name + ': ' + oldHash.substring(0,8) + ' -> ' + newHash.substring(0,8));
      if (entry.computedHash) entry.computedHash = newHash;
      if (entry.hash) entry.hash = newHash;
      updated++;
    }
  }
}

fs.writeFileSync(path.join(__dirname, '..', 'skills-lock.json'), JSON.stringify(lock, null, 2) + '\n');
console.log('Updated ' + updated + ' skill hashes');
