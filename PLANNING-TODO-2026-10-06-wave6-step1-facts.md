# Wave 6 — Step 1: read-only facts before building the new pricing card

Date: 2026-10-06

## What is already in the codebase (from this session's reads)

- `src/billing.js` already exports `deriveTier(priceId, env)`
  - enterprise → PADDLE_ENTERPRISE_PRICE_ID
  - company → PADDLE_COMPANY_PRICE_ID
  - anything else → contractor (fallback)
- `wrangler.jsonc` references only these Paddle names:
  - PADDLE_PRICE_ID
  - PADDLE_API_KEY
  - PADDLE_ENV
- The actual secret VALUES are not in the repo. They are Wrangler secrets
  (the values for PADDLE_PRICE_ID, PADDLE_COMPANY_PRICE_ID,
  PADDLE_ENTERPRISE_PRICE_ID, PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET).

## What the repo does NOT already have

- No homeowner/client price ID is referenced anywhere in the code today.
- No homeowner/client tier string is used by deriveTier today.
- No homeowner/client card exists on the pricing page.
- The router billing checkout path already accepts a `?tier=` param, and
  deriveTier is the gate between a price id and a tier string — so a new tier
  does not require a new checkout path, only a new price id + new tier branch.

## What still has to be confirmed before building the card

Owner asked for a separate homeowner/client subscription card with its own
price path. Before building that card, the exact price id has to come from the
live source of truth, not be invented locally.

The two places that can give us the real id are:

1. The live Paddle catalog / Paddle dashboard price for the homeowner/client plan.
2. The Wrangler secret list on the deployment (the actual `pri_...` value), if
   the owner has already created it and stored it there.

If the price id is not created yet, then the card can still be built, but it
cannot be wired to a real checkout until the id is added as a Wrangler secret
and deriveTier is extended to recognize it.

## Implication for the card build

Because the app already has:

- a 4-card layout,
- a comparison table,
- upgrade buttons that carry `data-tier`,
- a checkout route that reads `?tier=`,
- a deriveTier function that maps price ids to tiers,

the new card is mostly a markup + styling + one new tier branch, not a new
billing flow.

## Owner decision still needed before I build it

I need the actual homeowner/client price id (or confirmation that it is not
created yet) before the card can point at the right checkout. If you want, I
can:

- build the card now with a placeholder tier like `homeowner` and a clear
  TODO for the price id, or
- wait until you paste the live `pri_...` value or tell me where to read it.

Either way, the build step is not blocked by anything in the existing code —
it is blocked only by the missing price id.
