import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authEmailFrom } from '../src/lib/http.js';

// RESEND INSIGHTS (owner 2026-10-24): Resend warns against no-reply senders -
// a bare address tells recipients and inbox providers that replies are
// ignored, which costs inbox trust. authEmailFrom is the single composition
// point (sendAuthEmail is the only Resend dispatch in src/), so these cases
// pin the whole contract: never a nameless sender, never a double-wrapped
// one.

test('a bare configured address is wrapped name-backed', () => {
  assert.equal(
    authEmailFrom({ RESEND_FROM_EMAIL: 'support@mail.mymanagerworkspace.com' }),
    'My MaNaGeR <support@mail.mymanagerworkspace.com>'
  );
});

test('an already name-backed config passes through byte-identical', () => {
  const v = 'My MaNaGeR Support <support@mail.mymanagerworkspace.com>';
  assert.equal(authEmailFrom({ RESEND_FROM_EMAIL: v }), v);
});

test('no config at all falls back to the dev sender, still name-backed', () => {
  assert.equal(authEmailFrom({}), 'My MaNaGeR <onboarding@resend.dev>');
});

test('a non-string config value falls back instead of leaking into from', () => {
  assert.equal(authEmailFrom({ RESEND_FROM_EMAIL: 123 }), 'My MaNaGeR <onboarding@resend.dev>');
  assert.equal(authEmailFrom(undefined), 'My MaNaGeR <onboarding@resend.dev>');
});

test('surrounding whitespace in config is trimmed before wrapping', () => {
  assert.equal(
    authEmailFrom({ RESEND_FROM_EMAIL: '  hello@mail.example.com \n' }),
    'My MaNaGeR <hello@mail.example.com>'
  );
});
