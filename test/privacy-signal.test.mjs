/* ============================================================
   DNT / GPC SUPPRESSION (W6, 2026-10-15)
   ------------------------------------------------------------
   privacy.html section 7 told readers that a Do Not Track or
   Global Privacy Control signal suppresses our optional usage
   telemetry. Nothing read either header: the Analytics Engine
   binding has been live since 2026-08-25 and every write fired
   regardless. The policy claimed a suppression the code did not
   perform.

   These tests pin the fix at both ends - the header reader, and
   the write itself - because the second one is what makes the
   sentence on the page true.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privacySignalRequested, trackEvent, trackError } from '../src/lib/observe.js';

const req = headers => ({ headers: new Headers(headers) });

test('Sec-GPC: 1 is honoured', () => {
  assert.equal(privacySignalRequested(req({ 'Sec-GPC': '1' })), true);
});

test('DNT: 1 is honoured', () => {
  assert.equal(privacySignalRequested(req({ DNT: '1' })), true);
});

test('GPC wins on case and wording too', () => {
  assert.equal(privacySignalRequested(req({ 'sec-gpc': ' TRUE ' })), true);
});

test('no signal means tracked', () => {
  assert.equal(privacySignalRequested(req({})), false);
  assert.equal(privacySignalRequested(req({ 'Sec-GPC': '0' })), false);
  assert.equal(privacySignalRequested(req({ DNT: '0' })), false);
});

test('a missing request is not treated as a signal', () => {
  assert.equal(privacySignalRequested(null), false);
  assert.equal(privacySignalRequested(undefined), false);
  assert.equal(privacySignalRequested({}), false);
});

function countingEnv() {
  const points = [];
  return {
    points,
    ANALYTICS: {
      writeDataPoint: p => points.push(p)
    }
  };
}

test('trackEvent writes analytics without a signal', () => {
  const env = countingEnv();
  trackEvent(env, 'cloud-save', { projectId: 'p1' }, req({}));
  assert.equal(env.points.length, 1);
});

test('trackEvent writes NOTHING when DNT is set', () => {
  const env = countingEnv();
  trackEvent(env, 'cloud-save', { projectId: 'p1' }, req({ DNT: '1' }));
  assert.equal(env.points.length, 0, 'the privacy.html promise was not kept');
});

test('trackError writes NOTHING when GPC is set', () => {
  const env = countingEnv();
  trackError(env, 'api-unhandled', new Error('boom'), { path: '/api/x' }, req({ 'Sec-GPC': '1' }));
  assert.equal(env.points.length, 0, 'the privacy.html promise was not kept');
});

test('trackError still logs the error when suppressed - a fault must stay diagnosable', () => {
  const env = countingEnv();
  const written = [];
  const origLog = console.error;
  console.error = msg => written.push(String(msg));
  try {
    trackError(env, 'api-unhandled', new Error('boom'), { path: '/api/x' }, req({ DNT: '1' }));
  } finally {
    console.error = origLog;
  }
  assert.equal(env.points.length, 0);
  assert.ok(
    written.some(m => m.indexOf('api-unhandled') !== -1),
    'suppression must drop the analytics point, not the log line'
  );
});
