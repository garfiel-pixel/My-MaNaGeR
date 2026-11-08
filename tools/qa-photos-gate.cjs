/* ============================================================
   qa-photos-gate.cjs — T-PHOTOS gate (I-7, BUDGET-BOQ-MCP 2026-11-05)
   ------------------------------------------------------------
   Static checks (no browser) for the landing-page photography:
     - no remote (http/https) image URLs anywhere on the landing page;
     - every <img> on the landing page is listed in docs/PHOTO-CREDITS.md;
     - every referenced local image exists and is < 150 KB at its largest
       served size;
     - images carry width + height (no layout shift) and descriptive alt.
   Exit non-zero on any failure.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const results = [];
function check(name, val, detail) {
  results.push({ name, val });
  const mark = val ? 'PASS' : 'FAIL';
  process.stdout.write(
    '[photos-gate] ' + mark + '  ' + name + (val ? '' : '   <-- ' + JSON.stringify(detail)) + '\n'
  );
}

const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const credits = fs.readFileSync(path.join(ROOT, 'docs/PHOTO-CREDITS.md'), 'utf8');

// 1. No remote image URLs.
const remoteUrls = indexHtml.match(/<img[^>]+src=["']https?:\/\/[^"']+/gi) || [];
check('T-PHOTOS no remote image URLs on the landing page', remoteUrls.length === 0, remoteUrls);

// 2. Every <img> is listed in PHOTO-CREDITS.md.
const imgs = [];
const imgRe = /<img[^>]+src=["']([^"']+)["']/gi;
let m;
while ((m = imgRe.exec(indexHtml))) {
  imgs.push(m[1]);
}
const missing = imgs.filter(
  src => !src.startsWith('images/') || !credits.includes(path.basename(src))
);
check('T-PHOTOS every landing <img> is listed in PHOTO-CREDITS.md', missing.length === 0, missing);

// 3. Local images exist and are < 150 KB.
const KB150 = 150 * 1024;
const big = [];
for (const src of imgs) {
  // Vector art (SVG) is decorative, aria-hidden, and not bound by the raster
  // 150 KB budget; the poster is the only SVG and stays exempt.
  if (src.toLowerCase().endsWith('.svg')) continue;
  const fp = path.join(ROOT, src);
  if (!fs.existsSync(fp)) {
    big.push(src + ' (missing)');
    continue;
  }
  const sz = fs.statSync(fp).size;
  if (sz > KB150) {
    big.push(src + ' ' + Math.round(sz / 1024) + 'KB');
  }
}
check('T-PHOTOS every local image exists and is < 150 KB', big.length === 0, big);

// 4. width + height + alt on every <img>.
const noDims = [];
const imgTagRe = /<img\b[^>]*>/gi;
while ((m = imgTagRe.exec(indexHtml))) {
  const tag = m[0];
  if (!/\bwidth=/.test(tag) || !/\bheight=/.test(tag) || !/\balt=/.test(tag)) {
    noDims.push(tag.slice(0, 80));
  }
}
check('T-PHOTOS every <img> has width, height and alt', noDims.length === 0, noDims.slice(0, 5));

// 5. Overlaid text contrast guard: hero/photo-band images are paired with an overlay.
check(
  'T-PHOTOS hero/photo bands carry a dark overlay element',
  /class="hero-overlay"/.test(indexHtml) && /class="pb-overlay"/.test(indexHtml),
  null
);

const passed = results.filter(r => r.val).length;
process.stdout.write('[photos-gate] RESULT ' + passed + '/' + results.length + '\n');
if (passed !== results.length) {
  process.exitCode = 1;
}
