import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sniffImageType, stripExif, looksLikeMarkup } from '../src/cloud/photos.js';

// ---------------------------------------------------------------------------
// SEC-04 (audit 2026-11-01): a photo upload must not trust File.type, and EXIF
// must not travel to R2. These test the two pure helpers directly so a future
// refactor of the upload handler cannot silently drop the check.
// ---------------------------------------------------------------------------

const bytes = (...n) => Uint8Array.from(n);
const ascii = s => Uint8Array.from(s.split('').map(c => c.charCodeAt(0)));

function pngChunk(type, data) {
  const out = [];
  const len = data.length;
  // PNG chunk lengths are big-endian (WebP's RIFF sizes are little-endian).
  out.push((len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff);
  out.push(...ascii(type));
  out.push(...data);
  out.push(0, 0, 0, 0); // CRC is irrelevant to the stripper
  return out;
}
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function riffChunk(fourcc, data) {
  const out = [];
  const len = data.length;
  out.push(...ascii(fourcc));
  out.push(len & 0xff, (len >>> 8) & 0xff, (len >>> 16) & 0xff, (len >>> 24) & 0xff);
  out.push(...data);
  if (len % 2) out.push(0);
  return out;
}
function riff(chunks) {
  const body = chunks.flat();
  const total = 4 + body.length;
  return Uint8Array.from([
    0x52,
    0x49,
    0x46,
    0x46,
    total & 0xff,
    (total >>> 8) & 0xff,
    (total >>> 16) & 0xff,
    (total >>> 24) & 0xff,
    0x57,
    0x45,
    0x42,
    0x50,
    ...body
  ]);
}

test('sniffImageType recognises the five accepted formats', () => {
  assert.equal(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg');
  assert.equal(sniffImageType(Uint8Array.from(PNG_SIG)), 'image/png');
  assert.equal(
    sniffImageType(Uint8Array.from([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')])),
    'image/webp'
  );
  assert.equal(sniffImageType(ascii('GIF89a')), 'image/gif');
  assert.equal(sniffImageType(ascii('GIF87a')), 'image/gif');
  assert.equal(
    sniffImageType(Uint8Array.from([0, 0, 0, 0, ...ascii('ftyp'), ...ascii('avif')])),
    'image/avif'
  );
});

test('sniffImageType refuses a renamed HTML file', () => {
  assert.equal(sniffImageType(ascii('<!DOCTYPE html><html>')), '');
  assert.equal(sniffImageType(ascii('<script>alert(1)</script>')), '');
  assert.equal(sniffImageType(bytes()), '');
});

test('looksLikeMarkup catches a polyglot that hides markup after a real header', () => {
  const gifPolyglot = Uint8Array.from([...ascii('GIF89a'), ...ascii('<script>alert(1)</script>')]);
  assert.equal(looksLikeMarkup(gifPolyglot), true);
  assert.equal(looksLikeMarkup(ascii('GIF89a')), false);
  assert.equal(looksLikeMarkup(Uint8Array.from(PNG_SIG)), false);
});

test('stripExif leaves a clean JPEG byte-identical', () => {
  const clean = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9);
  assert.deepEqual(stripExif('image/jpeg', clean), clean);
});

test('stripExif removes a JPEG APP1 Exif segment', () => {
  const withExif = Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe1,
    0x00,
    0x08,
    ...ascii('Exif'),
    0,
    0,
    0xff,
    0xd9
  ]);
  const out = stripExif('image/jpeg', withExif);
  assert.equal(out.length < withExif.length, true);
  assert.equal(Buffer.from(out).indexOf('Exif'), -1);
  assert.deepEqual(out, bytes(0xff, 0xd8, 0xff, 0xd9));
});

test('stripExif removes a PNG eXIf chunk and leaves a clean PNG identical', () => {
  const clean = Uint8Array.from([...PNG_SIG, ...pngChunk('IEND', [])]);
  assert.deepEqual(stripExif('image/png', clean), clean);
  const withExif = Uint8Array.from([
    ...PNG_SIG,
    ...pngChunk('eXIf', [1, 2, 3]),
    ...pngChunk('IEND', [])
  ]);
  const out = stripExif('image/png', withExif);
  assert.equal(Buffer.from(out).indexOf('eXIf'), -1);
  assert.deepEqual(out, clean);
});

test('stripExif removes a WebP EXIF chunk and fixes the RIFF size', () => {
  const clean = riff([riffChunk('VP8 ', [1, 2, 3, 4])]);
  assert.deepEqual(stripExif('image/webp', clean), clean);
  const withExif = riff([riffChunk('VP8 ', [1, 2, 3, 4]), riffChunk('EXIF', [9, 9, 9, 9])]);
  const out = stripExif('image/webp', withExif);
  assert.equal(Buffer.from(out).indexOf('EXIF'), -1);
  assert.deepEqual(out, clean);
});

test('stripExif leaves GIF bytes unchanged (no EXIF container)', () => {
  const gif = Uint8Array.from([...ascii('GIF89a'), 1, 2, 3, 0x3b]);
  assert.deepEqual(stripExif('image/gif', gif), gif);
});
