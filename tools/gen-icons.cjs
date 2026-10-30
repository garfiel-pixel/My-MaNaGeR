#!/usr/bin/env node
/* tools/gen-icons.cjs - My MaNaGeR app icon pack, built from ONE vector master.
   --------------------------------------------------------------------------
   Source of truth: the gold tile the owner uses today = the repo's own
   monogram (css/mpw-mark.svg, 24-unit grid, 2-unit round strokes) drawn at
   90% of a rounded gold tile. Measured from the owner's 1024px artwork:
   tile corner radius 17.1% of width, glyph = the 24-grid scaled to 90%,
   tile gold #c49d26, glyph ink #1c1917.

   What it writes (OUT_DIR, default ./icon-pack):
     mpw-favicon.svg              any-purpose master (transparent rounded corners)
     mpw-icon-192.png             any, 192x192   (manifest)
     mpw-icon-512.png             any, 512x512   (manifest)
     mpw-icon-maskable-512.png    maskable, FULL BLEED, glyph inside the 80% safe circle
     mpw-icon-maskable-192.png    maskable, 192x192
     mpw-apple-touch-180.png      iOS: OPAQUE full-bleed square (iOS rounds it; transparent pixels turn black)
     mpw-icon-32.png, mpw-icon-48.png
     favicon.ico                  16 + 32 + 48 (PNG-in-ICO), for the /favicon.ico request browsers make by default

   Usage:  node tools/gen-icons.cjs [outDir]
   Needs:  playwright (already a devDependency of this repo's QA battery).
   To match the header tile and manifest theme_color exactly, set TILE_GOLD to '#d4af37'. */
'use strict';
const fs = require('fs');
const path = require('path');

const TILE_GOLD = '#d4af37'; // brand token --gold (bullion, 2026-10-30). Was the older #c49d26.
const INK = '#1c1917'; // --on-gold
const RX = 88; // 17.2% of 512 - measured corner radius
// The monogram, verbatim from css/mmgr-icons.svg #i-mpw (24x24 grid, stroke 2).
const GLYPH =
  '<path d="M3.5 17.5v-11l4.25 6L12 6.5l4.25 6 4.25-6v11"/>' +
  '<path d="M12 17.5v-5.2a2.4 2.4 0 1 1 2.4 2.4H12"/>' +
  '<path d="M3.5 21h17"/>';
// Glyph bounding box incl. stroke, in grid units: x 2.5..21.5, y 5.5..22 -> centre (12, 13.75).
const GCX = 12;
const GCY = 13.75;
const GHALF_DIAG = Math.sqrt(9.5 * 9.5 + 8.25 * 8.25); // 12.58 units

function glyphGroup(scale, tx, ty) {
  return (
    `<g transform="translate(${tx} ${ty}) scale(${scale})" fill="none" stroke="${INK}" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GLYPH}</g>`
  );
}
function svg(size, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">${body}</svg>`;
}
// ANY: transparent rounded tile, glyph = 24-grid at 90% centred (exactly the owner's artwork).
const anyBody =
  `<rect width="512" height="512" rx="${RX}" fill="${TILE_GOLD}"/>` + glyphGroup(19.2, 25.6, 25.6);
// IOS: same composition, but an opaque square (no transparency anywhere).
const iosBody =
  `<rect width="512" height="512" fill="${TILE_GOLD}"/>` + glyphGroup(19.2, 25.6, 25.6);
// MASKABLE: full bleed; glyph bbox centred, scaled so its far corners sit inside the safe circle
// (radius = 40% of the width, per web.dev). 16 units => 12.58 * 16 = 201 px <= 204.8 px.
const MASK_SCALE = 16;
const maskBody =
  `<rect width="512" height="512" fill="${TILE_GOLD}"/>` +
  glyphGroup(MASK_SCALE, 256 - GCX * MASK_SCALE, 256 - GCY * MASK_SCALE);
if (GHALF_DIAG * MASK_SCALE > 0.4 * 512) throw new Error('maskable glyph leaves the safe zone');

const JOBS = [
  { file: 'mpw-icon-192.png', size: 192, body: anyBody },
  { file: 'mpw-icon-512.png', size: 512, body: anyBody },
  { file: 'mpw-icon-maskable-512.png', size: 512, body: maskBody },
  { file: 'mpw-icon-maskable-192.png', size: 192, body: maskBody },
  { file: 'mpw-apple-touch-180.png', size: 180, body: iosBody },
  { file: 'mpw-icon-32.png', size: 32, body: anyBody },
  { file: 'mpw-icon-48.png', size: 48, body: anyBody },
  { file: '_ico16.png', size: 16, body: anyBody, temp: true }
];

function writeIco(outFile, pngs) {
  // PNG-in-ICO (supported by every current browser). pngs: [{size, buf}]
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach((p, i) => {
    dir.writeUInt8(p.size >= 256 ? 0 : p.size, i * 16);
    dir.writeUInt8(p.size >= 256 ? 0 : p.size, i * 16 + 1);
    dir.writeUInt8(0, i * 16 + 2);
    dir.writeUInt8(0, i * 16 + 3);
    dir.writeUInt16LE(1, i * 16 + 4);
    dir.writeUInt16LE(32, i * 16 + 6);
    dir.writeUInt32LE(p.buf.length, i * 16 + 8);
    dir.writeUInt32LE(offset, i * 16 + 12);
    offset += p.buf.length;
  });
  fs.writeFileSync(outFile, Buffer.concat([head, dir, ...pngs.map(p => p.buf)]));
}

(async () => {
  const { chromium } = require('playwright');
  const outDir = path.resolve(process.argv[2] || 'icon-pack');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'mpw-favicon.svg'), svg(512, anyBody) + '\n');
  const browser = await chromium.launch();
  const bufs = {};
  for (const j of JOBS) {
    const ctx = await browser.newContext({
      viewport: { width: j.size, height: j.size },
      deviceScaleFactor: 1
    });
    const page = await ctx.newPage();
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${svg(j.size, j.body)}</body></html>`
    );
    const buf = await page.screenshot({
      omitBackground: true,
      clip: { x: 0, y: 0, width: j.size, height: j.size }
    });
    bufs[j.file] = buf;
    if (!j.temp) fs.writeFileSync(path.join(outDir, j.file), buf);
    await ctx.close();
  }
  await browser.close();
  writeIco(path.join(outDir, 'favicon.ico'), [
    { size: 16, buf: bufs['_ico16.png'] },
    { size: 32, buf: bufs['mpw-icon-32.png'] },
    { size: 48, buf: bufs['mpw-icon-48.png'] }
  ]);
  console.log('icons written to ' + outDir);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
