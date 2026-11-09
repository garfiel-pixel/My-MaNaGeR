/* ============================================================
   PRODUCT EVENTS (B, 2026-11-09)
   ------------------------------------------------------------
   Five allowlisted event names, no identifiers, and the DNT/Sec-GPC skip.
   These tests pin the properties that make the counts safe to keep:

     - every allowlisted name writes exactly one data point;
     - an unknown name writes none;
     - a DNT or Sec-GPC request writes none;
     - a caller cannot smuggle an email, account id or project id into the
       data point by passing it as context - only `first` survives.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCT_EVENTS, trackEvent } from '../src/lib/observe.js';

function sink() {
  const points = [];
  return {
    points: points,
    env: {
      ANALYTICS: {
        writeDataPoint(point) {
          points.push(point);
        }
      }
    }
  };
}

function requestWith(headers) {
  return new Request('https://app.test/api/event', { method: 'POST', headers: headers || {} });
}

test('the allowlist is exactly the five agreed names', () => {
  assert.deepEqual(PRODUCT_EVENTS.slice(), [
    'signup',
    'project_created',
    'calculator_export',
    'mcp_key_created',
    'photo_uploaded'
  ]);
});

test('each allowlisted event writes one data point', () => {
  PRODUCT_EVENTS.forEach(function (name) {
    const s = sink();
    const wrote = trackEvent(s.env, name, {}, requestWith());
    assert.equal(wrote, true, name + ' did not write');
    assert.equal(s.points.length, 1, name + ' wrote ' + s.points.length + ' points');
    assert.deepEqual(s.points[0].indexes, ['event', name]);
  });
});

test('an unknown event name writes nothing', () => {
  const s = sink();
  const wrote = trackEvent(s.env, 'page_view', {}, requestWith());
  assert.equal(wrote, false);
  assert.equal(s.points.length, 0);
});

test('DNT and Sec-GPC both suppress the write', () => {
  const dnt = sink();
  assert.equal(trackEvent(dnt.env, 'signup', {}, requestWith({ DNT: '1' })), false);
  assert.equal(dnt.points.length, 0);

  const gpc = sink();
  assert.equal(trackEvent(gpc.env, 'signup', {}, requestWith({ 'Sec-GPC': '1' })), false);
  assert.equal(gpc.points.length, 0);
});

test('no identifier reaches the data point', () => {
  const s = sink();
  trackEvent(
    s.env,
    'project_created',
    {
      first: true,
      email: 'person@example.com',
      sub: 'google-123',
      projectId: 'p-999',
      name: 'A Person'
    },
    requestWith()
  );
  assert.equal(s.points.length, 1);
  const blob = s.points[0].blobs[0];
  assert.equal(blob, JSON.stringify({ first: true }));
  ['person@example.com', 'google-123', 'p-999', 'A Person'].forEach(function (needle) {
    assert.equal(blob.indexOf(needle), -1, 'identifier leaked: ' + needle);
  });
});

test('a non-boolean first is dropped rather than serialised', () => {
  const s = sink();
  trackEvent(s.env, 'project_created', { first: 'yes-please' }, requestWith());
  assert.equal(s.points[0].blobs[0], '{}');
});

test('no binding means no write and no throw', () => {
  assert.equal(trackEvent({}, 'signup', {}, requestWith()), false);
});
