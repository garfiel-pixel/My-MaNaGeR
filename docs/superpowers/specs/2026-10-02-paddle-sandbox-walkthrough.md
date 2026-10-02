# Directive — Paddle sandbox setup walkthrough for the Jamaica billing switch

## Why
LemonSqueezy does not support Jamaica-based sellers. Paddle supports Jamaican
sellers (their list excludes only sanctioned countries; Jamaica is not on it)
and charges per transaction with no setup or monthly fee. The billing framework
(Paddle path + LemonSqueezy legacy path behind the same `/api/billing/*`
routes, dormant until configured) is already built and verified at 83/83 gates.

## Plan
1. Create the product + price in Paddle (dashboard).
2. Create the webhook destination → `https://my-manager.garfieldprocis.workers.dev/api/billing/webhook`, subscribed to `subscription.*{created,activated,resumed,updated,canceled,paused,past_due}` + `transaction.completed`; copy the endpoint secret key.
3. Point the Worker at Paddle (sandbox first): set the three `PADDLE_*` secrets via `npx wrangler secret put`; `PADDLE_ENV=sandbox`.
4. Test the sandbox round-trip: `/api/billing/checkout` → hosted Paddle checkout → pay (sandbox card) → `subscription.activated` → entitlement.
5. Switch to production: create the product/price and the webhook in production, rotate the secrets, redeploy.
6. Retire LemonSqueezy: delete the four `LEMONSQUEEZY_*` secrets when ready.

## Files
- Framework: `src/billing.js`
- Gate: `tools/qa-email-auth.cjs` (phase 2b, PD1–PD7)
- Record: `docs/superpowers/plans/2026-10-01-paddle-billing-seam.md`
- Status: framework complete; awaiting the owner's dashboard items + secrets.

## Not started unless owner says
- JMD rate book keying from the owner's IMAJ/JIC extract (schema ready, extract not yet in the repo).
- Turning on the Upgrade flow in production.
