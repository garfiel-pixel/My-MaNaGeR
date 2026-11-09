/* ============================================================
   CSP REPORT LOG HYGIENE (E6, 2026-11-09)
   ------------------------------------------------------------
   A CSP report can carry a full document URL. The owner's log showed a Paddle
   checkout id and a client token inside those URLs. A log tail is exported and
   read by people who are not the account owner, so the query string and the
   fragment are stripped before the line is written.

   These tests pin the two halves: the pure stripper, and the real handler
   writing a line that keeps origin + path but loses every parameter.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cspStripQuery, handleCspReport } from '../src/csp-report.js';

const require = createRequire(import.meta.url);
const { formatViolation } = require('../tools/qa-csp-sweep.cjs');

test('query string and fragment are removed, origin and path kept', () => {
  assert.equal(
    cspStripQuery('https://mymanagerworkspace.com/pricing?checkout_id=ch_123&token=tok_abc'),
    'https://mymanagerworkspace.com/pricing'
  );
  assert.equal(cspStripQuery('https://example.test/a/b#fragment'), 'https://example.test/a/b');
  assert.equal(cspStripQuery('https://example.test/'), 'https://example.test/');
});

test('the literal keywords survive', () => {
  assert.equal(cspStripQuery('inline'), 'inline');
  assert.equal(cspStripQuery('eval'), 'eval');
  assert.equal(cspStripQuery(''), '');
});

test('a non-URL value is stripped textually, not dropped', () => {
  assert.equal(cspStripQuery('blob:https://example.test/x?y=1'), 'blob:https://example.test/x');
});

async function captureLines(payload) {
  const lines = [];
  const origWarn = console.warn;
  console.warn = function (msg) {
    lines.push(String(msg));
  };
  try {
    const req = new Request('https://mymanagerworkspace.com/api/csp-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const res = await handleCspReport(req, {});
    assert.equal(res.status, 204);
  } finally {
    console.warn = origWarn;
  }
  return lines;
}

async function captureReport(payload) {
  return (await captureLines(payload)).join('\n');
}

test('the real handler logs no query string', async () => {
  const line = await captureReport({
    'csp-report': {
      'document-uri':
        'https://mymanagerworkspace.com/pricing?checkout_id=ch_01HXYZ&token=pdl_ct_123',
      'blocked-uri': 'https://api.paddle.com/transactions?token=pdl_ct_123',
      'effective-directive': 'connect-src',
      disposition: 'report'
    }
  });
  assert.match(line, /csp-violation/);
  assert.match(line, /https:\/\/mymanagerworkspace\.com\/pricing/);
  assert.equal(line.indexOf('checkout_id'), -1, 'checkout id leaked');
  assert.equal(line.indexOf('pdl_ct_123'), -1, 'client token leaked');
  assert.equal(line.indexOf('?'), -1, 'a query string survived');
});

test('the Reporting API array shape is stripped too', async () => {
  const line = await captureReport([
    {
      type: 'csp-violation',
      body: {
        effectiveDirective: 'script-src-elem',
        blockedURL: 'inline',
        documentURL: 'https://mymanagerworkspace.com/app?session=abc#x',
        disposition: 'report'
      }
    }
  ]);
  assert.match(line, /script-src-elem/);
  assert.match(line, /"blocked":"inline"/);
  assert.match(line, /https:\/\/mymanagerworkspace\.com\/app/);
  assert.equal(line.indexOf('session=abc'), -1);
});

test('the logged blocked and document fields are exactly origin + path', async () => {
  const lines = await captureLines({
    'csp-report': {
      'document-uri':
        'https://mymanagerworkspace.com/pricing?checkout_id=ch_01HXYZ&token=pdl_ct_123#pay',
      'blocked-uri': 'https://public.profitwell.com/js/profitwell.js?auth=paddletoken_live_x#frag',
      'effective-directive': 'script-src-elem',
      disposition: 'enforce'
    }
  });
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.blocked, 'https://public.profitwell.com/js/profitwell.js');
  assert.equal(entry.document, 'https://mymanagerworkspace.com/pricing');
  assert.equal(entry.blocked.indexOf('/pricing'), -1, 'the page path leaked into blocked');
  assert.equal(entry.document.indexOf('?'), -1, 'a query string survived in document');
  assert.equal(entry.document.indexOf('#'), -1, 'a fragment survived in document');
});

test('inline stays exactly inline in both report shapes', async () => {
  const legacy = JSON.parse(
    (
      await captureLines({
        'csp-report': {
          'blocked-uri': 'inline',
          'document-uri': 'https://mymanagerworkspace.com/app?session=abc#x',
          'effective-directive': 'script-src-elem'
        }
      })
    )[0]
  );
  assert.equal(legacy.blocked, 'inline');
  assert.equal(legacy.document, 'https://mymanagerworkspace.com/app');

  const modern = JSON.parse(
    (
      await captureLines([
        {
          type: 'csp-violation',
          body: {
            effectiveDirective: 'script-src-elem',
            blockedURL: 'inline',
            documentURL: 'https://mymanagerworkspace.com/app#x',
            disposition: 'report'
          }
        }
      ])
    )[0]
  );
  assert.equal(modern.blocked, 'inline');
});

test('the sweep print keeps the page path out of the blocked value', () => {
  const line = formatViolation({
    directive: 'script-src-elem',
    blocked: 'https://public.profitwell.com/js/profitwell.js?auth=tok#frag',
    page: '/pricing',
    document: 'http://127.0.0.1:8794/pricing?checkout=1',
    disposition: 'enforce'
  });
  assert.match(
    line,
    /blocked=https:\/\/public\.profitwell\.com\/js\/profitwell\.js \| page=\/pricing \| disposition=enforce/
  );
  assert.match(line, /doc=http:\/\/127\.0\.0\.1:8794\/pricing$/);
  assert.equal(line.indexOf('/pricinghttps://'), -1, 'page path ran into the blocked URL');
  assert.equal(line.indexOf('?'), -1, 'a query string reached the printed line');
});
