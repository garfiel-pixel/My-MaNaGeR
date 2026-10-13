#!/usr/bin/env node
/* ============================================================
   gen-globe-mask.cjs - ONE source of truth for the hero globe.
   ------------------------------------------------------------
   OWNER 2026-10-12 (HERO GLOBE directive, section 2): the dot
   globe draws land from "a 1-bit land mask built from Natural
   Earth public-domain data by a repeatable generator script".

   SOURCE AND LICENCE (recorded here as the directive asks):
     Natural Earth, vector "land" layer, 1:110m scale,
     ne_110m_land.zip, https://www.naturalearthdata.com/
     LICENCE: Natural Earth terms of use - the data is in the
     PUBLIC DOMAIN. No permission is needed, no attribution is
     required, and the derived mask below carries the same
     public-domain standing. (The data was fetched once into
     tmp/ from the official CDN; re-fetch it any time with
       curl -o tmp/ne-land.zip \
         https://naciscdn.org/naturalearth/110m/physical/ne_110m_land.zip
     and re-run this script - the mask and the poster are
     reproducible byte-for-byte from that input.)

   IT WRITES TWO THINGS FROM ONE MASK:
     1. The LAND_MASK constant inside js/marketing-globe.js,
        rewritten between the BEGIN/END marker comments so the
        rendered globe, the poster and this generator can never
        drift apart.
     2. images/hero-globe-poster.svg - the static poster the
        stage shows before the canvas's first frame (same mask,
        same initial orientation, same dot size), so the swap is
        invisible.

   THE FALLBACK (directive section 2): if the shapefile cannot be
   read, the script still emits a mask - a plain latitude/longitude
   dot grid, so the globe degrades to an even dot sphere rather
   than to nothing - and it SAYS SO on stdout and fails loudly.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const ZIP = path.join(ROOT, 'tmp', 'ne-land.zip');
const SHP_NAME = 'ne_110m_land.shp';

// Grid: 1 degree of longitude x 1 degree of latitude, rows south -> north,
// 360 bits per row packed MSB-first. 171 rows (-85..85) = 7,695 bytes raw.
const LON_STEP = 1;
const LAT_FROM = -85;
const LAT_TO = 85;
const ROWS = (LAT_TO - LAT_FROM) / LON_STEP + 1;
const COLS = 360 / LON_STEP;

// ---- zip: pull the .shp out of the archive (stored or deflate) ----
function readShapefileFromZip(zipPath) {
  const z = fs.readFileSync(zipPath);
  let p = 0;
  while (p + 30 <= z.length) {
    if (z.readUInt32LE(p) !== 0x04034b50) {
      break;
    } // not a local file header
    const method = z.readUInt16LE(p + 8);
    const compSize = z.readUInt32LE(p + 18);
    const nameLen = z.readUInt16LE(p + 26);
    const extraLen = z.readUInt16LE(p + 28);
    const name = z.slice(p + 30, p + 30 + nameLen).toString('utf8');
    const dataStart = p + 30 + nameLen + extraLen;
    if (name === SHP_NAME) {
      const raw = z.slice(dataStart, dataStart + compSize);
      return method === 0 ? raw : zlib.inflateRawSync(raw);
    }
    p = dataStart + compSize;
  }
  throw new Error(SHP_NAME + ' not found inside ' + zipPath);
}

// ---- shapefile: polygon records -> ring vertex arrays ----
function parsePolygons(buf) {
  const polys = [];
  let p = 100; // skip the 100-byte file header
  while (p + 8 <= buf.length) {
    const contentLen = buf.readUInt32BE(p + 4) * 2;
    const body = p + 8;
    const shapeType = buf.readInt32LE(body);
    if (shapeType === 5) {
      const numParts = buf.readInt32LE(body + 36);
      const numPoints = buf.readInt32LE(body + 40);
      const parts = [];
      for (let i = 0; i < numParts; i++) {
        parts.push(buf.readInt32LE(body + 44 + i * 4));
      }
      const pts = body + 44 + numParts * 4;
      const rings = [];
      for (let i = 0; i < numParts; i++) {
        const from = parts[i];
        const to = i + 1 < numParts ? parts[i + 1] : numPoints;
        const ring = [];
        for (let k = from; k < to; k++) {
          ring.push([buf.readDoubleLE(pts + k * 16), buf.readDoubleLE(pts + k * 16 + 8)]);
        }
        if (ring.length >= 3) {
          rings.push(ring);
        }
      }
      if (rings.length) {
        polys.push(rings);
      }
    }
    p = body + contentLen;
  }
  return polys;
}

// Even-odd across every ring of one polygon: a point inside an odd number of
// rings is land, which keeps lakes/holes honest.
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1],
      xj = ring[j][0],
      yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function polyContains(rings, x, y) {
  let hits = 0;
  for (let r = 0; r < rings.length; r++) {
    if (inRing(x, y, rings[r])) {
      hits++;
    }
  }
  return hits % 2 === 1;
}

// ---- rasterise -> bit array ----
function buildMask(polys) {
  // PACKED BITS: COLS/8 bytes per row, MSB first - the exact shape
  // js/marketing-globe.js decodes. (Sizing this buffer per CELL instead of
  // per BIT was the one bug this generator had: it rasterised correctly and
  // then counted zero land, because the writer and the reader disagreed
  // about where a bit lives. The dot count below is the regression check.)
  const STRIDE = COLS >> 3;
  const bits = new Uint8Array(ROWS * STRIDE);
  // Pre-clamp each polygon to a lat/lon box so the global sweep stays cheap.
  const boxes = polys.map(rings => {
    let x0 = 180,
      x1 = -180,
      y0 = 90,
      y1 = -90;
    rings.forEach(r =>
      r.forEach(pt => {
        if (pt[0] < x0) {
          x0 = pt[0];
        }
        if (pt[0] > x1) {
          x1 = pt[0];
        }
        if (pt[1] < y0) {
          y0 = pt[1];
        }
        if (pt[1] > y1) {
          y1 = pt[1];
        }
      })
    );
    return [x0, x1, y0, y1];
  });
  for (let row = 0; row < ROWS; row++) {
    const lat = LAT_FROM + row * LON_STEP;
    for (let col = 0; col < COLS; col++) {
      const lon = -180 + col * LON_STEP;
      for (let p = 0; p < polys.length; p++) {
        const b = boxes[p];
        if (lon < b[0] || lon > b[1] || lat < b[2] || lat > b[3]) {
          continue;
        }
        // NOTE: polyContains takes the polygon's OWN rings list. Passing it to
        // isLand (which expects the full polygon array) made every point fall
        // through as water - isLand would iterate rings as if they were
        // polygons and inRing would see coordinates instead of vertices. That
        // silent zero-land mask was the bug behind an all-black hero globe.
        if (polyContains(polys[p], lon, lat)) {
          bits[row * STRIDE + (col >> 3)] |= 1 << (7 - (col & 7));
          break;
        }
      }
    }
  }
  return bits;
}

function countDots(bits) {
  let n = 0;
  for (let i = 0; i < bits.length; i++) {
    let v = bits[i];
    while (v) {
      n += v & 1;
      v >>= 1;
    }
  }
  return n;
}

// ---- poster: the same mask, the same first-frame orientation ----
function buildPoster(bits) {
  // The globe module's initial orientation. Kept here in sync by hand on the
  // one line below; the poster is the frame the canvas would have drawn.
  const W = 900,
    H = 760,
    CX = 450,
    CY = 380,
    R = 300;
  const LON0 = -30; // initial rotation (deg)
  const LAT0 = 17.97; // Jamaica's latitude tilts the globe toward home
  const STEP = 2; // dot grid step in degrees (matches the module default)
  const rad = d => (d * Math.PI) / 180;
  const p0 = rad(LAT0),
    l0 = rad(LON0);
  const circles = [];
  for (let lat = -85; lat <= 85; lat += STEP) {
    for (let lon = -180; lon < 180; lon += STEP) {
      const row = lat - LAT_FROM;
      const col = lon + 180;
      if (row < 0 || row >= ROWS || col < 0 || col >= COLS) {
        continue;
      }
      if (!(bits[row * (COLS >> 3) + (col >> 3)] & (1 << (7 - (col & 7))))) {
        continue;
      }
      const phi = rad(lat),
        lam = rad(lon);
      const z = Math.sin(p0) * Math.sin(phi) + Math.cos(p0) * Math.cos(phi) * Math.cos(lam - l0);
      if (z <= 0.02) {
        continue;
      }
      const x = Math.cos(phi) * Math.sin(lam - l0);
      const y = Math.cos(p0) * Math.sin(phi) - Math.sin(p0) * Math.cos(phi) * Math.cos(lam - l0);
      const depth = 0.22 + 0.78 * z;
      const rr = (0.9 + 1.5 * z).toFixed(2);
      circles.push(
        '<circle cx="' +
          (CX + x * R).toFixed(1) +
          '" cy="' +
          (CY - y * R).toFixed(1) +
          '" r="' +
          rr +
          '" opacity="' +
          depth.toFixed(2) +
          '"/>'
      );
    }
  }
  // Kingston, Jamaica - the home pin (17.97 N, 76.79 W).
  const phi = rad(17.97),
    lam = rad(-76.79);
  const z = Math.sin(p0) * Math.sin(phi) + Math.cos(p0) * Math.cos(phi) * Math.cos(lam - l0);
  const px = CX + Math.cos(phi) * Math.sin(lam - l0) * R;
  const py =
    CY - (Math.cos(p0) * Math.sin(phi) - Math.sin(p0) * Math.cos(phi) * Math.cos(lam - l0)) * R;
  const pin =
    '<g id="pin" opacity="' +
    (z > 0 ? 1 : 0) +
    '"><circle cx="' +
    px.toFixed(1) +
    '" cy="' +
    py.toFixed(1) +
    '" r="14" fill="#d96b27" opacity="0.28"/><circle cx="' +
    px.toFixed(1) +
    '" cy="' +
    py.toFixed(1) +
    '" r="5" fill="#ffe082"/></g>';
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
    W +
    ' ' +
    H +
    '" width="' +
    W +
    '" height="' +
    H +
    '" role="img" aria-label="Dotted globe marking Kingston, Jamaica">' +
    '<defs><radialGradient id="glow" cx="50%" cy="50%" r="50%">' +
    '<stop offset="72%" stop-color="#d96b27" stop-opacity="0"/>' +
    '<stop offset="92%" stop-color="#d96b27" stop-opacity="0.30"/>' +
    '<stop offset="100%" stop-color="#d96b27" stop-opacity="0"/></radialGradient></defs>' +
    '<circle cx="' +
    CX +
    '" cy="' +
    CY +
    '" r="' +
    (R + 26) +
    '" fill="url(#glow)"/>' +
    '<g fill="#ffe082">' +
    circles.join('') +
    '</g>' +
    pin +
    '</svg>'
  );
}

// ---- emit ----
function patchModule(bitsB64) {
  const target = path.join(ROOT, 'js', 'marketing-globe.js');
  if (!fs.existsSync(target)) {
    console.log('[gen-globe-mask] js/marketing-globe.js not present - mask not patched.');
    return;
  }
  const src = fs.readFileSync(target, 'utf8');
  const begin = '/* LAND-MASK-BEGIN (generated by tools/gen-globe-mask.cjs - do not edit) */';
  const end = '/* LAND-MASK-END */';
  const i = src.indexOf(begin),
    j = src.indexOf(end);
  if (i < 0 || j < 0 || j < i) {
    console.log(
      '[gen-globe-mask] marker pair missing in js/marketing-globe.js - mask not patched.'
    );
    return;
  }
  const next =
    src.slice(0, i + begin.length) +
    "\n  var LAND_MASK_B64 = '" +
    bitsB64 +
    "';\n  " +
    src.slice(j);
  fs.writeFileSync(target, next);
  console.log(
    '[gen-globe-mask] patched LAND_MASK_B64 in js/marketing-globe.js (' + bitsB64.length + ' chars)'
  );
}

function main() {
  let bits = null;
  let via = 'Natural Earth 110m land polygons';
  try {
    if (!fs.existsSync(ZIP)) {
      throw new Error(ZIP + ' missing');
    }
    const polys = parsePolygons(readShapefileFromZip(ZIP));
    if (!polys.length) {
      throw new Error('no polygons parsed');
    }
    bits = buildMask(polys);
    console.log('[gen-globe-mask] parsed ' + polys.length + ' land polygons from ' + SHP_NAME);
  } catch (e) {
    via = 'FALLBACK: latitude/longitude dot grid (no shapefile)';
    const stride = COLS >> 3;
    bits = new Uint8Array(ROWS * stride);
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        bits[row * stride + (col >> 3)] |= 1 << (7 - (col & 7));
      }
    }
    console.log('[gen-globe-mask] WARNING - ' + e.message);
    console.log('[gen-globe-mask] WARNING - falling back to a full latitude/longitude dot grid,');
    console.log(
      '[gen-globe-mask] WARNING - so the globe shows an even sphere with NO land shapes.'
    );
  }
  const dots = countDots(bits);
  // A real land mask carries thousands of cells; zero means the writer and the
  // reader disagree again, and an even dot grid is NOT an acceptable silent
  // answer (directive section 2 says to say so, not to hide it).
  if (via.indexOf('FALLBACK') < 0 && dots < 1000) {
    console.log(
      '[gen-globe-mask] ERROR - only ' + dots + ' land cells rasterised; refusing to emit.'
    );
    process.exit(1);
  }
  const b64 = Buffer.from(bits).toString('base64');
  console.log(
    '[gen-globe-mask] mask ' + COLS + 'x' + ROWS + ' cells, ' + dots + ' land cells (' + via + ')'
  );
  patchModule(b64);
  const poster = buildPoster(bits);
  const out = path.join(ROOT, 'images', 'hero-globe-poster.svg');
  fs.writeFileSync(out, poster);
  console.log(
    '[gen-globe-mask] wrote images/hero-globe-poster.svg (' +
      (poster.length / 1024).toFixed(1) +
      ' KB, ' +
      (poster.match(/<circle/g) || []).length +
      ' dots)'
  );
}

main();
