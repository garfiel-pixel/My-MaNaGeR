const fs = require('fs');
const crypto = require('crypto');

const HTML_FILES = [
  'project.html',
  'app.html',
  'admin.html',
  'dashboard.html',
  'seed-test.html',
  'mymanager-field-guide.html',
  'monolith html to reference from all features.html',
  'index.html',
  'features.html',
  'about.html',
  'contact.html',
  'reviews.html',
  'privacy.html',
  'terms.html'
];

function computeHashes(file){
  const src = fs.readFileSync(file, 'utf8');
  const hashes = [];
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(src)) !== null){
    hashes.push("'sha256-" + crypto.createHash('sha256').update(m[1]).digest('base64') + "'");
  }
  return hashes;
}

// Verifier's exact flattened order (includes repeats — this guard compares the
// full flat list against the hardcoded list, not the unique set).
const flat = HTML_FILES.flatMap(f => computeHashes(f));

const body = flat.map(h => '  ' + h + ',').join('\n');
const block = 'const INLINE_SCRIPT_HASHES = [\n' + body + '\n].join(\' \');\n';

fs.writeFileSync('canonical-hashes-block.js', block, 'utf8');
console.log('wrote canonical-hashes-block.js', block.length, 'bytes');
console.log('flat hash count:', flat.length);
console.log('unique hash count:', new Set(flat).size);
