#!/usr/bin/env node
/* tools/gen-og-image.cjs - the social card, built from the same vector master
   as the app icon pack (tools/gen-icons.cjs).
   --------------------------------------------------------------------------
   U-02 (2026-10-30): og:image used to be icon.svg. Facebook, LinkedIn, Slack
   and X do not render SVG previews, so every shared link showed no artwork.
   This writes images/og-image.png at 1200x630 - the size every scraper wants -
   with the gold tile on the left and the wordmark plus one line on the right.

   Usage:  node tools/gen-og-image.cjs [outFile]
   Needs:  playwright (already a devDependency of the QA battery).
   Re-run after any change to the tile gold, the glyph or the tagline. */
'use strict';
const fs = require('fs');
const path = require('path');

const TILE_GOLD = '#d4af37';
const INK = '#1c1917';
const BG = '#1a1614';
const W = 1200;
const H = 630;

const GLYPH =
  '<path d="M3.5 17.5v-11l4.25 6L12 6.5l4.25 6 4.25-6v11"/>' +
  '<path d="M12 17.5v-5.2a2.4 2.4 0 1 1 2.4 2.4H12"/>' +
  '<path d="M3.5 21h17"/>';

const TILE = 232;
const GLYPH_SCALE = (TILE * 0.9) / 24;

const html = `<!doctype html><html><body style="margin:0">
<div style="width:${W}px;height:${H}px;background:${BG};display:flex;align-items:center;gap:56px;padding:0 88px;box-sizing:border-box;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif">
  <svg width="${TILE}" height="${TILE}" viewBox="0 0 512 512" aria-hidden="true">
    <rect width="512" height="512" rx="88" fill="${TILE_GOLD}"/>
    <g transform="translate(${256 - 12 * ((TILE * 0.9) / 24)} ${256 - 13.75 * ((TILE * 0.9) / 24)}) scale(${GLYPH_SCALE})"
       fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      ${GLYPH}
    </g>
  </svg>
  <div style="color:#f5efe6">
    <div style="font-size:64px;font-weight:800;letter-spacing:-1px;line-height:1.05">MY MANAGER</div>
    <div style="font-size:27px;font-weight:600;color:${TILE_GOLD};letter-spacing:3px;text-transform:uppercase;margin-top:10px">Construction project workspace</div>
    <div style="font-size:28px;line-height:1.45;color:rgba(245,239,230,.82);margin-top:26px;max-width:700px">
      Charter, WBS, Gantt, budget, EVM, risks and claims. Works offline, no account needed.
    </div>
  </div>
</div></body></html>`;

(async () => {
  const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'images', 'og-image.png'));
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1
  });
  const page = await ctx.newPage();
  await page.setContent(html);
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } });
  fs.writeFileSync(out, buf);
  await browser.close();
  console.log('og image written to ' + out + ' (' + W + 'x' + H + ')');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
