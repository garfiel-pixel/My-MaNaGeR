#!/usr/bin/env node
// tools/diag-paddle-sub.cjs - which Paddle environment holds this subscription / price?
//
//   PADDLE_API_KEY_LIVE=pdl_live_apikey_...  PADDLE_API_KEY_SANDBOX=pdl_sdbx_apikey_... \
//     node tools/diag-paddle-sub.cjs sub_01m4e4v5652cz8vsgsz0eeaq96 pri_01... [more ids...]
//
// Accepts subscription ids (sub_...) and price ids (pri_...). A price id tells
// you which environment a PADDLE_*_PRICE_ID setting belongs to.
//
// The owner exports the keys in their OWN shell. They are read from the
// environment, sent only to Paddle, and never printed or logged. A key you do
// not have can simply be left out; that environment is reported as "skipped".
//
// Read-only: GET /subscriptions/{id} and GET /prices/{id} only.
const BASES = {
  live: 'https://api.paddle.com',
  sandbox: 'https://sandbox-api.paddle.com'
};

async function probe(env, key, id, fetchImpl) {
  const f = fetchImpl || fetch;
  if (!key) return { env, skipped: true };
  const kind = /^sub_[0-9a-z]+$/i.test(id)
    ? 'subscriptions'
    : /^pri_[0-9a-z]+$/i.test(id)
      ? 'prices'
      : '';
  if (!kind) return { env, id, invalidId: true };
  try {
    const res = await f(BASES[env] + '/' + kind + '/' + encodeURIComponent(id), {
      headers: { Authorization: 'Bearer ' + key }
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (body && body.error) || {};
      return {
        env,
        id,
        http: res.status,
        code: err.code || '',
        detail: String(err.detail || '').slice(0, 200)
      };
    }
    const d = (body && body.data) || {};
    if (kind === 'prices')
      return {
        env,
        id,
        http: res.status,
        status: d.status,
        product: d.product_id,
        name: d.name || d.description || null
      };
    return {
      env,
      id,
      http: res.status,
      status: d.status,
      customer: d.customer_id,
      nextBilledAt: d.next_billed_at || null,
      periodEnds: (d.current_billing_period && d.current_billing_period.ends_at) || null,
      scheduledChange: d.scheduled_change || null,
      prices: (d.items || []).map(i => i && i.price && i.price.id).filter(Boolean)
    };
  } catch (e) {
    return { env, id, error: String(e && e.message ? e.message : e).slice(0, 120) };
  }
}

// One plain-English verdict per subscription id.
function verdict(live, sandbox) {
  const found = r => r && r.http === 200;
  if (found(live) && found(sandbox)) return 'FOUND IN BOTH (unexpected - ids are unique)';
  if (found(live)) return 'LIVE: the live API knows this id';
  if (found(sandbox)) return 'SANDBOX ONLY: it exists in sandbox, the live API cannot see it';
  if (live && live.skipped && sandbox && sandbox.skipped) return 'NO KEYS SUPPLIED';
  return 'NOT FOUND in the environments you supplied a key for';
}

async function main() {
  const ids = process.argv.slice(2);
  if (!ids.length) {
    console.error('usage: node tools/diag-paddle-sub.cjs sub_... [pri_...] ...');
    process.exit(2);
  }
  const keys = {
    live: process.env.PADDLE_API_KEY_LIVE || '',
    sandbox: process.env.PADDLE_API_KEY_SANDBOX || ''
  };
  for (const id of ids) {
    const live = await probe('live', keys.live, id);
    const sandbox = await probe('sandbox', keys.sandbox, id);
    console.log('=== ' + id);
    [live, sandbox].forEach(r => console.log('  ' + JSON.stringify(r)));
    console.log('  VERDICT: ' + verdict(live, sandbox));
  }
}

module.exports = { probe, verdict };
if (require.main === module) main();
