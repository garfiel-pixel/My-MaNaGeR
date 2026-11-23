/* OWNER 2026-11-22: "ensure the higher paid tier actually has a proper AI
   and the AI actually runs through an AI". Proves against the REAL handler
   that a paying account reaches a real Gemini model (and company/enterprise
   step up to the stronger rung), while free stays on lite and no account is
   handed a canned local answer. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleAiChat } from '../src/ai-proxy.js';
import { signSession, sessionKey, __resetRateStateForTest } from '../src/lib/http.js';

beforeEach(() => __resetRateStateForTest());

const SECRET = 'tier-test-secret';

function fakeDb(sub) {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() {
              if (/FROM auth_sessions/.test(sql)) return { revoked_at: null };
              if (/FROM cloud_subscriptions WHERE owner_sub/.test(sql)) return sub;
              return null;
            },
            async run() {
              return {};
            }
          };
        }
      };
    }
  };
}
function fakeKv() {
  const store = new Map();
  return {
    async get(k) {
      return store.has(k) ? store.get(k) : null;
    },
    async put(k, v) {
      store.set(k, v);
    }
  };
}
async function request(env, body) {
  const key = await sessionKey(env);
  const token = await signSession(
    { sub: 'owner-1', email: 'o@example.com', exp: Math.floor(Date.now() / 1000) + 3600 },
    key
  );
  return new Request('https://x.test/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'mmgr_session=' + token },
    body: JSON.stringify(
      Object.assign(
        { provider: 'google-gemini', messages: [{ role: 'user', content: 'hi' }] },
        body || {}
      )
    )
  });
}
function withFetch(fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    return fn(String(url), init || {});
  };
  return { calls, done: () => (globalThis.fetch = real) };
}
const ok = () =>
  new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: 'real model answer' }] } }] }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }
  );

async function modelFor(tier, requested) {
  const env = {
    DB: fakeDb(tier ? { status: 'active', tier } : null),
    KV: fakeKv(),
    GOOGLE_CLIENT_SECRET: SECRET,
    GEMINI_KEY_1: 'POOL-KEY'
  };
  const h = withFetch(() => ok());
  try {
    const res = await handleAiChat(await request(env, requested ? { model: requested } : {}), env);
    const data = await res.json();
    return { status: res.status, data, url: h.calls[0] || '' };
  } finally {
    h.done();
  }
}

test('free account reaches a real model but stays on the lite rung', async () => {
  const r = await modelFor(null);
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.text, 'real model answer');
  assert.match(r.url, /gemini-flash-lite-latest/);
});

test('estimator and contractor paid accounts step up to gemini-flash-latest', async () => {
  for (const tier of ['estimator', 'contractor']) {
    const r = await modelFor(tier);
    assert.equal(r.status, 200, tier);
    assert.equal(r.data.text, 'real model answer', tier);
    assert.equal(r.data.model, 'gemini-flash-latest', tier);
    assert.match(r.url, /models\/gemini-flash-latest:generateContent/, tier);
    assert.doesNotMatch(r.url, /gemini-flash-lite-latest/, tier);
  }
});

test('company and enterprise step UP to the strongest model on the real endpoint', async () => {
  for (const tier of ['company', 'enterprise']) {
    const r = await modelFor(tier);
    assert.equal(r.status, 200, tier);
    assert.equal(r.data.model, 'gemini-pro-latest', tier);
    assert.match(r.url, /models\/gemini-pro-latest:generateContent/, tier);
    assert.doesNotMatch(r.url, /gemini-flash-lite-latest/, tier);
  }
});

test('a free account cannot pin itself to the stronger model by asking', async () => {
  const r = await modelFor(null, 'gemini-flash-lite-latest');
  assert.match(r.url, /gemini-flash-lite-latest/);
  assert.doesNotMatch(r.url, /gemini-2\.5-pro/);
});
