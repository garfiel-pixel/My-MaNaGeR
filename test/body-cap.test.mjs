import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJsonBody, readCloudBody } from '../src/lib/http.js';
import { validateBody } from '../src/lib/validate.js';

// T-5 (AUDIT-DIRECTIVE-2026-10-22 sweep): request.json() buffers and parses
// the whole body before anyone can inspect its size, so a large body was
// parsed for free and rate limits (which bound request COUNT, not BYTES) did
// nothing about it. These cases pin the capped reader's contract at its
// boundaries: the cheap Content-Length reject, the stream budget that catches
// a chunked body with NO Content-Length (the hole a CL-only check leaves),
// the exact-cap boundary (over fails, equal passes), and validateBody finally
// honoring its documented maxSize.

const URL = 'https://example.test/api';

function jsonReq(text, headers = {}) {
  return new Request(URL, { method: 'POST', body: text, headers });
}

// A request whose body arrives as a stream with no Content-Length header -
// the shape a browser chunked POST takes and a CL-only pre-check misses.
function streamReq(chunks) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(c));
      }
      controller.close();
    }
  });
  return new Request(URL, { method: 'POST', body, duplex: 'half' });
}

test('Content-Length over the cap is refused before the body is read', async () => {
  const read = await readJsonBody(jsonReq('{"a":1}', { 'content-length': '999999' }), 8192);
  assert.deepEqual(read, { tooLarge: true });
});

test('a chunked stream over the budget is refused even with no Content-Length', async () => {
  const read = await readJsonBody(streamReq(['x'.repeat(5000), 'y'.repeat(5000)]), 8192);
  assert.deepEqual(read, { tooLarge: true });
});

test('a body under the cap parses to the object', async () => {
  const read = await readJsonBody(jsonReq('{"email":"a@b.co","password":"hunter2!"}'), 8192);
  assert.deepEqual(read, { body: { email: 'a@b.co', password: 'hunter2!' } });
});

test('a body exactly at the cap passes; one byte over fails', async () => {
  const body = JSON.stringify({ pad: 'x'.repeat(60) });
  const bytes = Buffer.byteLength(body, 'utf8');
  const atCap = await readJsonBody(jsonReq(body), bytes);
  assert.deepEqual(atCap, { body: JSON.parse(body) });
  const over = await readJsonBody(jsonReq(body), bytes - 1);
  assert.deepEqual(over, { tooLarge: true });
});

test('multi-byte characters count as bytes, not characters', async () => {
  // "€" is 3 UTF-8 bytes; 4 of them plus JSON syntax must exceed a 14-byte cap
  // even though the string is only 11 characters.
  const body = JSON.stringify({ t: '€€€€' });
  const read = await readJsonBody(jsonReq(body), 14);
  assert.deepEqual(read, { tooLarge: true });
  const read2 = await readJsonBody(jsonReq(body), Buffer.byteLength(body, 'utf8'));
  assert.deepEqual(read2, { body: JSON.parse(body) });
});

test('malformed JSON under the cap reports bad, not tooLarge', async () => {
  const read = await readJsonBody(jsonReq('{oops'), 8192);
  assert.deepEqual(read, { bad: true });
});

test('a request with no body reports bad instead of throwing', async () => {
  const read = await readJsonBody(new Request(URL, { method: 'POST' }), 8192);
  assert.deepEqual(read, { bad: true });
});

test('readCloudBody keeps its 8 MiB contract through the delegate', async () => {
  const over = await readCloudBody(jsonReq('{}', { 'content-length': String(9 * 1048576) }));
  assert.deepEqual(over, { tooLarge: true });
  const under = await readCloudBody(jsonReq('{"ok":true}'));
  assert.deepEqual(under, { body: { ok: true } });
});

test('readJsonBody with no explicit cap falls back to the cloud 8 MiB cap', async () => {
  const over = await readJsonBody(jsonReq('{}', { 'content-length': String(9 * 1048576) }));
  assert.deepEqual(over, { tooLarge: true });
});

test('validateBody honors its maxSize argument (the parameter was dead)', async () => {
  const body = JSON.stringify({ note: 'y'.repeat(4096) });
  const capped = await validateBody(jsonReq(body), { note: { type: 'string' } }, 1024);
  assert.ok(capped.error instanceof Response);
  assert.equal(capped.error.status, 413);
  const ok = await validateBody(jsonReq(body), { note: { type: 'string' } }, 65536);
  assert.ok(ok.ok, 'under the cap the body validates');
  const bad = await validateBody(jsonReq('{oops'), { note: { type: 'string' } });
  assert.ok(bad.error instanceof Response);
  assert.equal(bad.error.status, 400);
});
