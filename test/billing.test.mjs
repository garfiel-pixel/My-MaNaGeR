import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingStatusActive, billingFreeCap, deriveTier } from '../src/billing.js';

test('billingStatusActive: active, on_trial and past_due are active (D1 grace)', () => {
  assert.equal(billingStatusActive('active'), true);
  assert.equal(billingStatusActive('on_trial'), true);
  assert.equal(billingStatusActive('past_due'), true);
});

test('billingStatusActive: cancelled, expired, paused and unknown are not active', () => {
  assert.equal(billingStatusActive('canceled'), false);
  assert.equal(billingStatusActive('cancelled'), false);
  assert.equal(billingStatusActive('expired'), false);
  assert.equal(billingStatusActive('paused'), false);
  assert.equal(billingStatusActive(''), false);
  assert.equal(billingStatusActive(undefined), false);
  assert.equal(billingStatusActive(null), false);
});

test('billingFreeCap: default is 1 (D3)', () => {
  assert.equal(billingFreeCap({}), 1);
  assert.equal(billingFreeCap(undefined), 1);
  assert.equal(billingFreeCap(null), 1);
});

test('billingFreeCap: a positive FREE_PROJECT_CAP overrides the default', () => {
  assert.equal(billingFreeCap({ FREE_PROJECT_CAP: 2 }), 2);
  assert.equal(billingFreeCap({ FREE_PROJECT_CAP: '5' }), 5);
});

test('billingFreeCap: a non-positive or unreadable override falls back to 1', () => {
  assert.equal(billingFreeCap({ FREE_PROJECT_CAP: 0 }), 1);
  assert.equal(billingFreeCap({ FREE_PROJECT_CAP: -3 }), 1);
  assert.equal(billingFreeCap({ FREE_PROJECT_CAP: 'nope' }), 1);
});

test('deriveTier: maps the enterprise price ID to enterprise', () => {
  const env = {
    PADDLE_ENTERPRISE_PRICE_ID: 'pri_ent',
    PADDLE_COMPANY_PRICE_ID: 'pri_com',
    PADDLE_PRICE_ID: 'pri_con'
  };
  assert.equal(deriveTier('pri_ent', env), 'enterprise');
});

test('deriveTier: maps the company price ID to company', () => {
  const env = {
    PADDLE_ENTERPRISE_PRICE_ID: 'pri_ent',
    PADDLE_COMPANY_PRICE_ID: 'pri_com',
    PADDLE_PRICE_ID: 'pri_con'
  };
  assert.equal(deriveTier('pri_com', env), 'company');
});

test('deriveTier: any other known price ID is contractor', () => {
  const env = {
    PADDLE_ENTERPRISE_PRICE_ID: 'pri_ent',
    PADDLE_COMPANY_PRICE_ID: 'pri_com',
    PADDLE_PRICE_ID: 'pri_con'
  };
  assert.equal(deriveTier('pri_con', env), 'contractor');
});

test('deriveTier: an unrecognised price ID falls back to contractor (never a downgrade)', () => {
  const env = { PADDLE_ENTERPRISE_PRICE_ID: 'pri_ent', PADDLE_COMPANY_PRICE_ID: 'pri_com' };
  assert.equal(deriveTier('pri_unknown', env), 'contractor');
});

test('deriveTier: a missing price ID or env is contractor', () => {
  assert.equal(deriveTier(null, { PADDLE_PRICE_ID: 'pri_con' }), 'contractor');
  assert.equal(deriveTier('pri_ent', null), 'contractor');
  assert.equal(deriveTier(undefined, undefined), 'contractor');
});
