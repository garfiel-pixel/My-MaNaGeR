import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleAiChat } from '../src/ai-proxy.js';
import { signSession, sessionKey } from '../src/lib/http.js';

// ---------------------------------------------------------------------------
// The managed free pool (owner 2026-10-08): the free section's AI runs on the
// owner's own Google keys, held as Worker secrets GEMINI_KEY_1..4, capped at
// 10 messages per 24h for accounts without an active subscription.
//
// These call the REAL handler against the REAL key selection and quota logic,
// with env and fetch faked. They exist because "the pool is wired" is the kind
// of claim that is easy to make and hard to see: a rung that is never reached,
// a cap that never counts, or a client-supplied model that quietly overrides
// the free model all look identical from the outside.
// ---------------------------------------------------------------------------

const SECRET = 'test-google-client-secret';
const LITE = 'gemini-flash-lite-latest';

function fakeDb(rows) {
  const log = [];
  return {
    log,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              log.push({ sql, args, kind: 'first' });
              if (/FROM auth_sessions/.test(sql)) return { revoked_at: null };
              if (/FROM cloud_subscriptions WHERE owner_sub/.test(sql)) return rows.sub || null;
              return null;
            },
            async run() {
              log.push({ sql, args, kind: 'run' });
              return {};
            }
          };
        }
      };
    }
  };
}

function fakeKv(initial) {
  const store = new Map(initial || []);
  const puts = [];
  return {
    store,
    puts,
    async get(k) {
      return store.has(k) ? store.get(k) : null;
    },
    async put(k, v, opts) {
      puts.push({ key: k, value: v, opts: opts || {} });
      store.set(k, v);
    }
  };
}

async function chatRequest(env, body, opts) {
  const headers = { 'Content-Type': 'application/json' };
  if (!(opts && opts.anon)) {
    const key = await sessionKey(env);
    const token = await signSession(
      {
        sub: (opts && opts.sub) || 'owner-1',
        email: 'o@example.com',
        exp: Math.floor(Date.now() / 1000) + 3600
      },
      key
    );
    headers.Cookie = 'mmgr_session=' + token;
  }
  return new Request('https://x.test/api/ai/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify(
      Object.assign(
        { provider: 'google-gemini', messages: [{ role: 'user', content: 'hi' }] },
        body || {}
      )
    )
  });
}

function geminiOk(text) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: text }] } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return handler(String(url), init || {});
  };
  return fn(calls).finally(() => {
    globalThis.fetch = real;
  });
}

const BASE = {
  GOOGLE_CLIENT_SECRET: SECRET,
  GEMINI_KEY_1: 'POOLKEY-ONE',
  GEMINI_KEY_2: 'POOLKEY-TWO'
};

function envWith(extra) {
  const rows = { sub: null };
  return Object.assign({ DB: fakeDb(rows), KV: fakeKv(), _rows: rows }, BASE, extra || {});
}

test('pool: (no key, no Workers AI, signed in) answers from the pool with the lite model', async () => {
  const env = envWith();
  await withFetch(
    () => geminiOk('pool answer'),
    async calls => {
      const res = await handleAiChat(await chatRequest(env, {}), env);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.text, 'pool answer');
      assert.equal(data.source, 'free-pool');
      assert.equal(data.model, LITE);
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /gemini-flash-lite-latest/);
    }
  );
});

test('pool: the model the CLIENT asked for is ignored (lite only, per owner rule)', async () => {
  const env = envWith();
  await withFetch(
    () => geminiOk('x'),
    async calls => {
      const res = await handleAiChat(
        await chatRequest(env, { model: 'gemini-2.5-pro', provider: 'google-gemini' }),
        env
      );
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.model, LITE);
      assert.doesNotMatch(calls[0].url, /gemini-2\.5-pro/);
      assert.match(calls[0].url, /gemini-flash-lite-latest/);
    }
  );
});

test('pool: a rate-limited key is skipped and the next key answers', async () => {
  const env = envWith();
  let n = 0;
  await withFetch(
    () => {
      n += 1;
      return n === 1
        ? new Response('{"error":"quota"}', { status: 429 })
        : geminiOk('second key answer');
    },
    async calls => {
      const res = await handleAiChat(await chatRequest(env, {}), env);
      assert.equal(res.status, 200);
      assert.equal((await res.json()).text, 'second key answer');
      assert.equal(calls.length, 2);
      assert.equal(calls[0].init.headers['x-goog-api-key'], 'POOLKEY-ONE');
      assert.equal(calls[1].init.headers['x-goog-api-key'], 'POOLKEY-TWO');
    }
  );
});

test('pool: a rejected key (401) is skipped too', async () => {
  const env = envWith();
  let n = 0;
  await withFetch(
    () => {
      n += 1;
      return n === 1 ? new Response('{"error":"bad key"}', { status: 401 }) : geminiOk('recovered');
    },
    async calls => {
      const res = await handleAiChat(await chatRequest(env, {}), env);
      assert.equal(res.status, 200);
      assert.equal(calls.length, 2);
    }
  );
});

test('pool: unset slots are skipped (two keys set = two attempts, not four)', async () => {
  const env = envWith({ GEMINI_KEY_3: undefined, GEMINI_KEY_4: undefined });
  await withFetch(
    () => new Response('{"error":"nope"}', { status: 429 }),
    async calls => {
      const res = await handleAiChat(await chatRequest(env, {}), env);
      assert.equal(res.status, 503); // every key failed -> the capacity message
      assert.equal(calls.length, 2);
    }
  );
});

test('pool: when EVERY key fails the existing capacity message still answers', async () => {
  const env = envWith();
  await withFetch(
    () => new Response('{"error":"down"}', { status: 503 }),
    async () => {
      const res = await handleAiChat(await chatRequest(env, {}), env);
      assert.equal(res.status, 503);
      const data = await res.json();
      assert.equal(data.ok, false);
      assert.equal(data.tier, 'workers-ai');
      assert.match(data.error, /at capacity/);
    }
  );
});

test('pool: a signed-out caller never reaches the pool (no account to cap)', async () => {
  const env = envWith();
  await withFetch(
    () => geminiOk('should not happen'),
    async calls => {
      const res = await handleAiChat(await chatRequest(env, {}, { anon: true }), env);
      assert.equal(res.status, 503);
      assert.equal(calls.length, 0);
    }
  );
});

test('pool: a request carrying the user OWN key never touches the pool', async () => {
  const env = envWith();
  await withFetch(
    () => geminiOk('byo answer'),
    async calls => {
      const req = await chatRequest(env, {});
      req.headers.set('X-User-Api-Key', 'USER-OWN-KEY');
      const res = await handleAiChat(req, env);
      assert.equal(res.status, 200);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].init.headers['x-goog-api-key'], 'USER-OWN-KEY');
    }
  );
});

test('pool: the free model is used even when the caller asked for another provider', async () => {
  const env = envWith();
  await withFetch(
    () => geminiOk('ok'),
    async calls => {
      const res = await handleAiChat(await chatRequest(env, { provider: 'openai' }), env);
      assert.equal(res.status, 200);
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /generativelanguage\.googleapis\.com/);
      assert.doesNotMatch(calls[0].url, /api\.openai\.com/);
    }
  );
});

test('quota: the 11th message in a window is refused with 402 and spends NO key', async () => {
  const env = envWith({ KV: fakeKv([['aifree:owner-1', '10']]) });
  await withFetch(
    () => geminiOk('should not happen'),
    async calls => {
      const res = await handleAiChat(await chatRequest(env, {}), env);
      assert.equal(res.status, 402);
      const data = await res.json();
      assert.equal(data.ok, false);
      assert.equal(data.tier, 'free-pool');
      assert.equal(data.remaining, 0);
      assert.match(data.error, /10 free AI messages/);
      assert.equal(calls.length, 0, 'an exhausted quota must not call the provider');
    }
  );
});

test('quota: 402 is NOT 429/503 (the client ladder must not retry it)', async () => {
  const env = envWith({ KV: fakeKv([['aifree:owner-1', '10']]) });
  await withFetch(
    () => geminiOk('x'),
    async () => {
      const res = await handleAiChat(await chatRequest(env, {}), env);
      assert.equal(res.status, 402);
      assert.notEqual(res.status, 429);
      assert.notEqual(res.status, 503);
    }
  );
});

test('quota: the counter is spent on a successful answer and reported as remaining', async () => {
  const env = envWith({ KV: fakeKv([['aifree:owner-1', '9']]) });
  await withFetch(
    () => geminiOk('last one'),
    async () => {
      const res = await handleAiChat(await chatRequest(env, {}), env);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.remaining, 0);
      assert.equal(env.KV.store.get('aifree:owner-1'), '10');
      assert.equal(env.KV.puts.length, 1);
      assert.equal(env.KV.puts[0].opts.expirationTtl, 86400);
    }
  );
});

test('quota: the first message starts the counter at 1 with a 24h window', async () => {
  const env = envWith();
  await withFetch(
    () => geminiOk('first'),
    async () => {
      const res = await handleAiChat(await chatRequest(env, {}), env);
      const data = await res.json();
      assert.equal(data.remaining, 9);
      assert.equal(env.KV.store.get('aifree:owner-1'), '1');
      assert.equal(env.KV.puts[0].key, 'aifree:owner-1');
      assert.equal(env.KV.puts[0].opts.expirationTtl, 86400);
    }
  );
});

test('quota: a failed rung does NOT spend the quota', async () => {
  const env = envWith({ KV: fakeKv([['aifree:owner-1', '3']]) });
  await withFetch(
    () => new Response('{"error":"down"}', { status: 503 }),
    async () => {
      await handleAiChat(await chatRequest(env, {}), env);
      assert.equal(env.KV.store.get('aifree:owner-1'), '3');
      assert.equal(env.KV.puts.length, 0);
    }
  );
});

test('quota: an ACTIVE subscription is not capped', async () => {
  const env = envWith({ KV: fakeKv([['aifree:owner-1', '10']]) });
  env._rows.sub = { status: 'active' };
  await withFetch(
    () => geminiOk('paid answer'),
    async calls => {
      const res = await handleAiChat(await chatRequest(env, {}), env);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.text, 'paid answer');
      assert.equal(data.remaining, null);
      assert.equal(calls.length, 1);
      assert.equal(env.KV.puts.length, 0, 'a paying account must not consume the free quota');
    }
  );
});

test('quota: a past_due subscription counts as active (D1 grace window)', async () => {
  const env = envWith({ KV: fakeKv([['aifree:owner-1', '10']]) });
  env._rows.sub = { status: 'past_due' };
  await withFetch(
    () => geminiOk('grace'),
    async () => {
      const res = await handleAiChat(await chatRequest(env, {}), env);
      assert.equal(res.status, 200);
    }
  );
});

test('quota: a CANCELED subscription is capped again', async () => {
  const env = envWith({ KV: fakeKv([['aifree:owner-1', '10']]) });
  env._rows.sub = { status: 'canceled' };
  await withFetch(
    () => geminiOk('x'),
    async calls => {
      const res = await handleAiChat(await chatRequest(env, {}), env);
      assert.equal(res.status, 402);
      assert.equal(calls.length, 0);
    }
  );
});

test('quota: a missing KV binding still answers (cache fault must not take AI down)', async () => {
  const env = envWith({ KV: undefined });
  await withFetch(
    () => geminiOk('no kv'),
    async () => {
      const res = await handleAiChat(await chatRequest(env, {}), env);
      assert.equal(res.status, 200);
      assert.equal((await res.json()).text, 'no kv');
    }
  );
});

test('quota: an unreadable counter is treated as zero, not as an error', async () => {
  const env = envWith({ KV: fakeKv([['aifree:owner-1', 'not-a-number']]) });
  await withFetch(
    () => geminiOk('ok'),
    async () => {
      const res = await handleAiChat(await chatRequest(env, {}), env);
      assert.equal(res.status, 200);
      assert.equal((await res.json()).remaining, 9);
    }
  );
});

test('quota: a D1 fault fails CLOSED (treated as free) so the pool cannot be drained', async () => {
  const env = envWith({ KV: fakeKv([['aifree:owner-1', '10']]) });
  env.DB = {
    prepare() {
      throw new Error('D1 unavailable');
    }
  };
  await withFetch(
    () => geminiOk('x'),
    async calls => {
      const res = await handleAiChat(await chatRequest(env, {}), env);
      assert.equal(res.status, 402);
      assert.equal(calls.length, 0);
    }
  );
});

test('pool: no key secret is ever echoed back to the caller', async () => {
  const env = envWith();
  await withFetch(
    () => geminiOk('safe'),
    async () => {
      const res = await handleAiChat(await chatRequest(env, {}), env);
      const raw = await res.text();
      assert.doesNotMatch(raw, /POOLKEY-ONE/);
      assert.doesNotMatch(raw, /POOLKEY-TWO/);
      assert.doesNotMatch(raw, /GEMINI_KEY_/);
    }
  );
});

test('pool: the quota counter is keyed per account, not globally', async () => {
  const env = envWith({ KV: fakeKv([['aifree:owner-1', '10']]) });
  await withFetch(
    () => geminiOk('other account'),
    async () => {
      const res = await handleAiChat(await chatRequest(env, {}, { sub: 'owner-2' }), env);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.remaining, 9);
      assert.equal(env.KV.store.get('aifree:owner-2'), '1');
    }
  );
});

test('pool: a 200 with no usable text falls through instead of answering empty', async () => {
  const env = envWith();
  await withFetch(
    () => new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    async calls => {
      const res = await handleAiChat(await chatRequest(env, {}), env);
      assert.equal(res.status, 503);
      assert.equal(calls.length, 2); // both keys were tried
    }
  );
});

// ---------------------------------------------------------------------------
// Rung ORDER (plan A1: BYO -> pool -> Workers AI -> capacity message). These
// three cases exist because the order is the whole design: putting Workers AI
// first would quietly starve the pool and hand free users the weaker engine.
// ---------------------------------------------------------------------------

test('order: the pool answers BEFORE the Workers AI binding is tried', async () => {
  let aiCalls = 0;
  const env = envWith({
    AI: {
      async run() {
        aiCalls += 1;
        return { response: 'edge answer' };
      }
    }
  });
  await withFetch(
    () => geminiOk('pool answer'),
    async calls => {
      const res = await handleAiChat(await chatRequest(env, {}), env);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.source, 'free-pool');
      assert.equal(data.text, 'pool answer');
      assert.equal(calls.length, 1, 'the key pool was the rung that answered');
      assert.equal(aiCalls, 0, 'Workers AI must not run when the pool can answer');
    }
  );
});

test('order: Workers AI is the safety net when every pool key fails', async () => {
  let aiCalls = 0;
  const env = envWith({
    AI: {
      async run() {
        aiCalls += 1;
        return { response: 'edge answer' };
      }
    }
  });
  await withFetch(
    () => new Response('{"error":"down"}', { status: 503 }),
    async calls => {
      const res = await handleAiChat(await chatRequest(env, {}), env);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.source, 'workers-ai');
      assert.equal(data.text, 'edge answer');
      assert.equal(calls.length, 2, 'both keys were tried first');
      assert.equal(aiCalls, 1);
    }
  );
});

test('quota: an exhausted allowance refuses BEFORE Workers AI (the cap is a cap)', async () => {
  let aiCalls = 0;
  const env = envWith({
    KV: fakeKv([['aifree:owner-1', '10']]),
    AI: {
      async run() {
        aiCalls += 1;
        return { response: 'edge answer' };
      }
    }
  });
  await withFetch(
    () => geminiOk('x'),
    async calls => {
      const res = await handleAiChat(await chatRequest(env, {}), env);
      assert.equal(res.status, 402);
      assert.equal(calls.length, 0);
      assert.equal(aiCalls, 0, 'an exhausted cap must not fall through to another engine silently');
    }
  );
});
