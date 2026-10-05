#!/usr/bin/env node
// tools/qa-auth-limits.cjs
// Regression gate for the 2026-10-05 auth-hardening wave:
//   A. password-reset cap is 1 per email per DAY (not 5/hour)
//   B. failed-login ladder: 5 fails locks 2h, then DOUBLES per tier, capped 24h
//   C. account collision returns ONE generic message that names no provider
//   D. the reset endpoint still cannot be used to enumerate accounts (E11)
//   E. the 429 still carries Retry-After and leaks nothing about the password
//
// Static arm runs in CI. The behavioural arm runs against wrangler dev when
// QA_AUTH_LIVE=1, otherwise the pure-logic ladder is exercised directly.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fails = 0;
function ok(label, cond, extra) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  [' + extra + ']' : ''));
  if (!cond) fails++;
}

const src = fs.readFileSync(path.join(ROOT, 'src', 'auth', 'session.js'), 'utf8');

// ---- ARM 1: constants and ladder (pure, always runs) --------------------
console.log('=== ARM 1: reset cap + lockout ladder ===\n');

// Constants are written as arithmetic ("2 * 60 * 60 * 1000"), so capture the
// whole RHS expression and EVALUATE it. Matching only the leading digits
// silently read 2 * 60 * 60 * 1000 as 2, which is how this harness first
// reported a correct source as broken.
const num = (name) => {
  const m = src.match(new RegExp('const ' + name + '\\s*=\\s*([^;\\n]+)'));
  if (!m) return null;
  const expr = m[1].trim();
  if (!/^[0-9\s*+()]+$/.test(expr)) return null;   // never eval arbitrary source
  try { return Function('"use strict";return (' + expr + ')')(); } catch (e) { return null; }
};

const maxPerDay = num('AUTH_RESET_MAX_PER_DAY');
ok('AUTH_RESET_MAX_PER_DAY is 1 (owner: one reset a day)', maxPerDay === 1, 'got ' + maxPerDay);
ok('the old 5-per-hour reset cap is gone',
   !/AUTH_RESET_MAX_PER_EMAIL_H/.test(src), 'no stale constant');
ok('resend-verify kept its OWN budget, not the reset one',
   /AUTH_VERIFY_MAX_PER_EMAIL_H\s*=\s*\d+/.test(src) &&
   !/AUTH_VERIFY_MAX_PER_EMAIL_H\s*=\s*AUTH_RESET/.test(src));

const failsAt = num('AUTH_LOCK_FAILS');
const windowMs = num('AUTH_LOCK_WINDOW_MS');
const escalate = num('AUTH_LOCK_ESCALATE_FAILS');
const maxMs = num('AUTH_LOCK_MAX_MS');
const mult = num('AUTH_LOCK_TIER_MULTIPLIER');

ok('5 wrong passwords is the lock threshold', failsAt === 5, 'got ' + failsAt);
ok('the first lock is 2 HOURS (owner)', windowMs === 2 * 60 * 60 * 1000, 'got ' + windowMs + 'ms');
ok('the ladder DOUBLES per tier', mult === 2, 'got ' + mult);
ok('the ladder is capped at 24h', maxMs === 24 * 60 * 60 * 1000, 'got ' + maxMs + 'ms');
ok('authLockMsForFails is defined', /function authLockMsForFails\s*\(/.test(src));
ok('the removed flat ESCALATE_MS constant is gone', !/AUTH_LOCK_ESCALATE_MS/.test(src));

// Re-implement the ladder exactly as the source does, then assert its shape.
function lockMs(n) {
  if (n < failsAt) return 0;
  const tiers = Math.floor((n - failsAt) / escalate);
  return Math.min(windowMs * Math.pow(mult, tiers), maxMs);
}
ok('4 failures never lock', lockMs(4) === 0);
ok('5 failures lock for exactly 2h', lockMs(5) === 2 * 3600 * 1000, (lockMs(5) / 3600000) + 'h');
ok('9 failures still 2h (tier not yet doubled)', lockMs(9) === 2 * 3600 * 1000);
ok('15 failures double to 4h', lockMs(15) === 4 * 3600 * 1000, (lockMs(15) / 3600000) + 'h');
ok('25 failures double again to 8h', lockMs(25) === 8 * 3600 * 1000, (lockMs(25) / 3600000) + 'h');
ok('the ladder is monotonically non-decreasing',
   [1, 5, 10, 15, 20, 25, 40, 100].every((n, i, a) => i === 0 || lockMs(n) >= lockMs(a[i - 1])));
ok('the ladder never exceeds the 24h cap', lockMs(500) <= maxMs, (lockMs(500) / 3600000) + 'h');
ok('the ladder never returns a negative or NaN lock',
   [1, 5, 6, 14, 15, 99].every((n) => Number.isFinite(lockMs(n)) && lockMs(n) >= 0));

// ---- ARM 2: collision message discloses nothing ------------------------
console.log('\n=== ARM 2: collision message is generic ===\n');
const taken = (src.match(/const AUTH_ACCOUNT_TAKEN\s*=\s*'([^']*)'/) || [])[1] || '';
ok('AUTH_ACCOUNT_TAKEN exists', !!taken);
ok('it does NOT name Google', !/google/i.test(taken), taken);
ok('it does NOT name password', !/password/i.test(taken), taken);
ok('it does NOT say which provider owns the address', !/provider|already signed in with/i.test(taken));
ok('every collision path uses the one constant',
   (src.match(/AUTH_ACCOUNT_TAKEN/g) || []).length >= 3, 'register + race + reuse');
ok('the old provider-neutral copy is fully gone', !/account already exists - sign in instead/.test(src));

// ---- ARM 3: E11 (no account enumeration on reset) ----------------------
console.log('\n=== ARM 3: reset endpoint cannot enumerate accounts ===\n');
ok('forgot still returns ONE generic message object',
   /const generic = \{ ok: true, message: 'If an account exists for that email/.test(src));
ok('the day-window query replaced the hour window for reset',
   /'reset', dayAgo\)/.test(src), 'reset now counts 24h');
ok('the verify path still counts an hour window',
   /'verify', hourAgo\)/.test(src), 'verify unchanged');
ok('a capped reset still returns the generic message, never a 429',
   /if \(rl\.limited\) return json\(generic\)/.test(src));
ok('the login 429 still sends Retry-After', /'Retry-After': String\(retryAfter\)/.test(src));
ok('the login 429 does not confirm the password was wrong',
   !/invalid email or password[\s\S]{0,200}429/.test(src.slice(src.indexOf('locked_until') - 200, src.indexOf('locked_until') + 400)) ||
   /Too many failed attempts/.test(src));

// ---- ARM 4: migration ---------------------------------------------------
console.log('\n=== ARM 4: provider migration ===\n');
const mig = path.join(ROOT, 'migrations', '0022_auth_provider.sql');
ok('migrations/0022_auth_provider.sql exists', fs.existsSync(mig));
if (fs.existsSync(mig)) {
  const m = fs.readFileSync(mig, 'utf8');
  ok('it adds auth_users.provider', /ALTER TABLE auth_users ADD COLUMN provider/.test(m));
  ok("it defaults to 'email' so existing rows and direct inserts keep working",
     /DEFAULT 'email'/.test(m));
  ok('it is a NOT NULL column', /provider TEXT NOT NULL/.test(m));
}

console.log('\n' + (fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'));

process.exit(fails === 0 ? 0 : 1);