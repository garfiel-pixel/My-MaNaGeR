/* ============================================================
   FX - USD to JMD estimate rate
   ------------------------------------------------------------
   Paddle bills in USD (JMD is not one of its 33 settlement currencies),
   so every J$ figure on the marketing site is an ESTIMATE. This module is
   the one place that owns the number.

   The rate is refreshed once a day inside the existing 06:00 UTC cron. The
   stored value is only replaced when it passes three checks - numeric, inside
   a wide sanity band, and within 5% of the value it replaces - so a broken
   feed can never move the published estimate by an order of magnitude. A
   failed refresh keeps yesterday's number and logs a warning.

   The seed exists so a fresh deployment (or an empty KV) still answers with
   a usable figure instead of hiding the J$ lines on day one.

   Source: currency-api (fawazahmed0), a free keyless JSON feed published
   under the MIT licence. No account, no key, no attribution requirement.
   Two hosts are tried in order; the second is the project's own Pages
   mirror and is used only when jsDelivr does not answer.
   ============================================================ */

export const JMD_PER_USD_SEED = 158;
export const SEED_AS_OF = '2026-11-09';
export const FX_MIN = 100;
export const FX_MAX = 250;
export const FX_MAX_JUMP = 0.05;
export const FX_STALE_MS = 14 * 24 * 60 * 60 * 1000;
export const FX_SOURCE = 'currency-api (fawazahmed0)';

const FX_KV_KEY = 'fx:usd-jmd';
const FX_URLS = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
  'https://latest.currency-api.pages.dev/v1/currencies/usd.json'
];

// Rounds a J$ estimate to the nearest 100 so the page reads "about J$3,000"
// rather than a precision the rate does not support.
export function fxRoundJmd(usd, rate) {
  const amount = Number(usd);
  const r = Number(rate);
  if (!Number.isFinite(amount) || !Number.isFinite(r) || r <= 0) {
    return null;
  }
  return Math.round((amount * r) / 100) * 100;
}

// A candidate is accepted only when it is a real number inside the sanity
// band and does not jump more than 5% from the value it would replace.
export function fxAccept(candidate, previous) {
  const next = Number(candidate);
  if (!Number.isFinite(next) || next < FX_MIN || next > FX_MAX) {
    return false;
  }
  const prev = Number(previous);
  if (Number.isFinite(prev) && prev > 0) {
    if (Math.abs(next - prev) / prev > FX_MAX_JUMP) {
      return false;
    }
  }
  return true;
}

// Reads the JMD rate out of the feed's shape: { date, usd: { jmd: 158.2 } }.
export function fxRateFromPayload(payload) {
  const raw = payload && payload.usd ? payload.usd.jmd : undefined;
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  const rate = Number(raw);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function seedRecord() {
  return { rate: JMD_PER_USD_SEED, asOf: SEED_AS_OF, source: FX_SOURCE };
}

function normaliseRecord(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const rate = Number(value.rate);
  const asOf = String(value.asOf || '').slice(0, 10);
  if (!Number.isFinite(rate) || rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return null;
  }
  return { rate: rate, asOf: asOf, source: String(value.source || FX_SOURCE).slice(0, 80) };
}

// Newest of stored / seed. The seed is deliberately not "fallback only": a
// deployment that has never refreshed must still publish the seed's date, and
// a stored value older than the seed loses to it.
export function fxNewest(stored) {
  const seed = seedRecord();
  const rec = normaliseRecord(stored);
  if (!rec) {
    return seed;
  }
  return rec.asOf >= seed.asOf ? rec : seed;
}

export function fxAvailable(record, nowMs) {
  const rec = normaliseRecord(record);
  if (!rec) {
    return false;
  }
  const asOfMs = Date.parse(rec.asOf + 'T00:00:00Z');
  if (!Number.isFinite(asOfMs)) {
    return false;
  }
  return nowMs - asOfMs <= FX_STALE_MS;
}

export async function fxRead(env, nowMs) {
  let stored = null;
  try {
    if (env && env.KV) {
      stored = await env.KV.get(FX_KV_KEY, 'json');
    }
  } catch (e) {
    /* a KV failure falls back to the seed, never to an error page */
  }
  const rec = fxNewest(stored);
  return {
    available: fxAvailable(rec, Number.isFinite(nowMs) ? nowMs : Date.now()),
    jmdPerUsd: rec.rate,
    asOf: rec.asOf,
    source: rec.source
  };
}

export async function fxRefresh(env, fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) {
    return { ok: false, reason: 'no-fetch' };
  }
  const stored = normaliseRecord(
    env && env.KV
      ? await env.KV.get(FX_KV_KEY, 'json').catch(function () {
          return null;
        })
      : null
  );
  const previous = stored ? stored.rate : JMD_PER_USD_SEED;
  for (let i = 0; i < FX_URLS.length; i++) {
    try {
      const res = await doFetch(FX_URLS[i], { headers: { Accept: 'application/json' } });
      if (!res || !res.ok) {
        continue;
      }
      const payload = await res.json();
      const rate = fxRateFromPayload(payload);
      if (rate === null) {
        continue;
      }
      if (!fxAccept(rate, previous)) {
        console.log(
          'fx refresh refused: rate=' + rate + ' previous=' + previous + ' source=' + FX_URLS[i]
        );
        return { ok: false, reason: 'rejected', rate: rate, previous: previous };
      }
      const asOf = new Date().toISOString().slice(0, 10);
      const record = { rate: rate, asOf: asOf, source: FX_SOURCE };
      if (env && env.KV) {
        await env.KV.put(FX_KV_KEY, JSON.stringify(record));
      }
      console.log('fx refresh: rate=' + rate + ' asOf=' + asOf);
      return { ok: true, rate: rate, asOf: asOf };
    } catch (e) {
      /* try the next host */
    }
  }
  console.log('fx refresh failed: no source answered; keeping ' + previous);
  return { ok: false, reason: 'no-source', previous: previous };
}

// GET /api/fx - public, same-origin, cacheable for an hour. The response is
// deliberately tiny and carries no visitor information.
export async function handleFx(env) {
  const fx = await fxRead(env);
  return new Response(
    JSON.stringify({
      available: fx.available,
      jmdPerUsd: fx.jmdPerUsd,
      asOf: fx.asOf
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600'
      }
    }
  );
}
