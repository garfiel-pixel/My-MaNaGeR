import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pkceChallenge } from '../src/mcp/oauth.js';

// RFC 7636 section 4.2 + appendix B. A hex challenge is self-consistent but
// no RFC-compliant client (Claude, Cursor, ChatGPT) can ever match it, so this
// vector is the guard that keeps the server honest.
test('PKCE S256 is base64url SHA-256, not hex', async () => {
  const challenge = await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
  assert.equal(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.equal(challenge.length, 43);
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
  assert.equal(/^[0-9a-f]{64}$/.test(challenge), false);
});
