# Paddle billing seam - execution record (2026-10-01)

Owner directive: LemonSqueezy does not support Jamaica ("our nation") for
sellers; Paddle does. Build the framework toward Paddle NOW so the later
incorporation is quick; do not throw LemonSqueezy away yet.

## Research (primary sources)

- Paddle supported countries (paddle.com/help/start/intro-to-paddle/
  which-countries-are-supported-by-paddle): Paddle works with sellers
  "anywhere in the world" EXCEPT a sanctioned-countries list - Jamaica is
  NOT on it (Haiti is). Confirms the owner's claim.
- Alternatives checked (web, 2026-10-01): FastSpring and Dodo Payments are
  the only plausible MoR candidates; neither is a clear win over Paddle for
  a Jamaican solo seller (both more niche, similar per-transaction fees).
  Paddle stands as the target.
- Webhook signature (developer.paddle.com/webhooks/about/signature-verification):
  `Paddle-Signature: ts=<unix>;h1=<hex>` (multiple h1 possible during secret
  rotation - accept any match); signed payload = `ts + ':' + rawBody` with the
  raw body byte-identical; HMAC-SHA256 keyed with the notification
  destination's secret; SDKs reject a timestamp older than 5 s (Paddle
  retries rejected deliveries, so a tight window is safe).
- Checkout (developer.paddle.com create-transaction): POST /transactions with
  `items[{price_id, quantity}]` + `custom_data`; the response carries
  `checkout.url`. Find-or-create the customer by email first so the hosted
  checkout carries the account email. transaction.custom_data flows to the
  subscription created from it - the webhook maps `custom_data.sub` back to
  the owner identity.

## What shipped (the framework)

- `src/billing.js` rewritten as a DUAL-PROVIDER SEAM behind the SAME routes
  and the SAME `cloud_subscriptions` table - the client Upgrade flow (cloud
  drawer banner, plan pills, /api/billing/status JSON shape) is untouched:
  - `billingProvider(env)`: PADDLE_WEBHOOK_SECRET + PADDLE_API_KEY +
    PADDLE_PRICE_ID -> 'paddle' (PREFERRED when both sets exist); else the
    four LEMONSQUEEZY_* secrets -> 'lemonsqueezy'; else null.
  - Dormant until either set (unchanged contract): status configured:false,
    checkout 503, cloud-create cap OFF.
  - Webhook dispatch by signature header: `Paddle-Signature` -> Paddle verify
    (ts/h1, timing-safe, 5 s replay tolerance), `X-Signature` -> LemonSqueezy
    verify (raw-body HMAC hex). No header -> 401.
  - Paddle lifecycle mapping: subscription.created/activated/resumed/updated/
    trialed/paused/past_due/canceled store the Paddle status ('trialing' is
    normalized to 'on_trial'); transaction.completed grants pro with no
    period end (one-time purchase). Confirmation/cancellation emails fire on
    subscription.activated / subscription.canceled.
  - ls_subscription_id column now holds "the provider's subscription or
    transaction id" for whichever provider wrote the row (one row per owner,
    latest wins) - NO schema change, NO migration.
- `tools/qa-email-auth.cjs` gains PHASE 2b (a wrangler restarted with ONLY
  PADDLE_* vars + FREE_PROJECT_CAP=2, because billingProvider prefers Paddle):
  PD1 status provider:'paddle', PD2 checkout honest 502 on a fake key, PD3
  cap still gates, PD4 valid-signature subscription.activated upsert, PD5
  active + cap cleared, PD6 garbage/tampered/stale/header-less 401 + unknown
  event ignored, PD7 one-time grant. LS phases B1-B6 unchanged and green.
- Registry row updated (83/83). No client assets touched -> no sw bump, no
  CSP changes, no emoji surface.

## Verification

- qa-email-auth 83/83 (local wrangler dev; API phases via MMGR_QA_NO_BROWSER=1)
- npm run verify green (shell v350 still newer than all 41 assets)

## Incorporation later (the owner's dashboard + secrets task)

1. Create the Paddle product + price; copy the price id (pri_...).
2. Paddle > Developer tools > Notifications: create a webhook destination
   pointing at https://my-manager.garfieldprocis.workers.dev/api/billing/webhook
   subscribed to subscription.* and transaction.completed events; copy the
   destination's secret key.
3. Set the secrets (Paddle sandbox first, PADDLE_ENV=sandbox, then production):
   `npx wrangler secret put PADDLE_API_KEY` /
   `npx wrangler secret put PADDLE_WEBHOOK_SECRET` /
   `npx wrangler secret put PADDLE_PRICE_ID` /
   (optional) `npx wrangler secret put PADDLE_ENV` with value sandbox.
4. From that moment billingProvider() flips to paddle - status reports
   provider:'paddle', checkout opens Paddle's hosted checkout, the webhook
   unlocks entitlements. To RETIRE LemonSqueezy:
   `npx wrangler secret delete LEMONSQUEEZY_API_KEY` (and the other three).
   Until then LemonSqueezy keeps working for any legacy checkout.
5. A live round-trip (sandbox checkout -> transaction.completed ->
   entitlement flip) is the one thing that needs real Paddle credentials;
   PD1-PD7 already gate every code path around it.
