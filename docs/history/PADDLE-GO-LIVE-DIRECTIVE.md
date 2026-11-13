# PADDLE-GO-LIVE DIRECTIVE (2026-10-05)

**Goal:** clicking "Upgrade to Premium" opens Paddle checkout, a completed purchase turns Premium on, cancelling turns it off.
**Companion file:** `paddle-fix.patch` (place at repo root). Tested against the exact upload `mymanager-fixed__3_.zip`.
**Format rule:** every step has a VERIFY line. A step is done only when its VERIFY prints the expected result. Do not pause between verified steps. Stop only on the conditions in section 6.

---

## 0. Diagnosis (reproduced, not guessed)

**What Paddle does** (developer.paddle.com, "Pass a transaction to a checkout"): `checkout.url` = your default payment link + `?_ptxn=<txn id>`. If that page includes Paddle.js, Paddle.js opens the checkout for that transaction automatically. Nothing else is required of the page.

**Root cause 1 (code, critical).** In `js/marketing.js` the page ran `handlePaddleReturn()` before `initPaddleWhenReady()`. `handlePaddleReturn()` treated `_ptxn` as a "you have returned from Paddle" marker and deleted it from the address bar with `history.replaceState`. By the time `Paddle.Initialize()` ran, the URL was bare `/pricing`, so Paddle had nothing to open.
Reproduced against the shipped `dist/marketing-bundle.js`: `Paddle.Initialize` received `search=""`. After the fix it receives `?_ptxn=txn_...`.
This is exactly your symptom: Upgrade sends you to `/pricing` and nothing happens.

**Root cause 2 (delivery, critical).** `worker.js` serves every `.js` file with `Cache-Control: immutable, max-age=1 year`. Every marketing page loads `dist/marketing-bundle.js` with no version in the URL, and `sw.js` fills its cache through the HTTP cache. Any browser that already holds an older bundle (yours does) keeps running it after a deploy. A correct fix would appear to do nothing.

**Verified healthy (no change needed):** secrets plumbing and provider selection, `POST /transactions` creation, signature verification (valid accepted, forged rejected, stale timestamp rejected), webhook route runs before the same-origin gate, live CSP, `custom_data` mapping (Paddle copies it to the subscription and to every renewal), no secrets present in the repo files.

---

## 1. Rules for the agent

1. Read `AGENTS.md` first. Its rules apply: CSP hash regeneration, rebuild bundles after any `js/` edit, deploy only from the staging copy, Conventional Commits, no AI credit lines in commits, no emoji on served pages.
2. Touch only the files named in Phase A. No refactors, no extra cleanups.
3. Run all of Phase A in one pass without asking questions.
4. Phase B and Phase C need the owner. State clearly when you reach them and what the owner must do.

---

## 2. Phase A: AGENT (code, build, deploy)

**A1. Apply the patch.**

```bash
git apply --check paddle-fix.patch && git apply paddle-fix.patch
```

Files changed: `js/marketing.js`, `src/billing.js`, `worker.js`, `serve.cjs`, `pricing.html`.
VERIFY: `git diff --stat` lists exactly those five files.

**A2. Version the bundle URL on the other eight marketing pages** (pricing.html is already done by the patch).

```bash
for f in about contact features index privacy refund reviews terms; do
  sed -i 's#dist/marketing-bundle.js"#dist/marketing-bundle.js?v=368"#' $f.html
done
```

VERIFY: `grep -c 'marketing-bundle.js?v=368' about.html contact.html features.html index.html privacy.html refund.html reviews.html terms.html pricing.html` prints `1` for each of the nine files.

**A3. Rebuild.**

```bash
node build.js --marketing
```

VERIFY (all four):

- `grep -c "checkout.completed" dist/marketing-bundle.js` is at least 1
- `grep -c "Checkout did not complete" dist/marketing-bundle.js` is at least 1
- `grep -c "Payment received" dist/marketing-bundle.js` is exactly 0
- `grep -c "subscription transaction" src/billing.js` is exactly 1

**A4. Bump the service worker. This must be the LAST edit to any shell file.**

```bash
sed -i "s/const CACHE = 'mmgr-shell-v367'; \/\/ /const CACHE = 'mmgr-shell-v368'; \/\/ v368: PADDLE CHECKOUT NOW OPENS - _ptxn is no longer stripped before Paddle.Initialize; marketing bundle URL versioned. \/\/ /" sw.js
```

VERIFY: `grep -c "const CACHE = 'mmgr-shell-v368'" sw.js` prints `1`.

**A5. Run the gates.**

```bash
npm run verify
```

VERIFY: exit code 0. (Changed files contain no new inline scripts, so no CSP hash change is expected. If `verify:csp` fails, run `node tools/regen-csp-hashes.cjs` and re-run.)
Then `node tools/qa-paddle-csp.cjs`. It needs Chromium and network access to Paddle's CDN; if it fails only for network reasons, note it and continue. If a static assertion fails, STOP.

**A6. Commit (two commits, no attribution footer).**

```
fix(billing): stop renewal and out-of-order Paddle events overwriting plans
fix(pricing): let Paddle.js read _ptxn before the page touches the URL
```

Body of each: one short paragraph of cause and effect. Nothing else.

**A7. Deploy using the staging recipe in AGENTS.md section 7** (`STAGE="$HOME/mmgr-deploy"`, never `/tmp`).
Before `wrangler deploy`, VERIFY the staged copy:

- `grep -c "checkout.completed" "$STAGE/dist/marketing-bundle.js"` is at least 1
- `grep -c "subscription transaction" "$STAGE/src/billing.js"` is 1
- `grep -c "mmgr-shell-v368" "$STAGE/sw.js"` is at least 1

**A8. Post-deploy VERIFY against production.**

```bash
curl -s https://mymanagerworkspace.com/pricing | grep -c "marketing-bundle.js?v=368"        # 1
curl -s "https://mymanagerworkspace.com/dist/marketing-bundle.js?v=368" | grep -c "checkout.completed"   # at least 1
curl -sI https://mymanagerworkspace.com/pricing | grep -i "^content-security-policy" | grep -c "sandbox-buy.paddle.com"   # 1
```

Phase A is complete when all three print the expected values. Report this to the owner and continue to Phase B.

---

## 3. Phase B: OWNER (Paddle dashboard and secrets)

Everything below must come from the **same Paddle account and environment** (all live, or all sandbox).

| #   | Item                     | Where                                                        | Required value                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Default payment link     | Paddle > Checkout > Checkout settings > Default payment link | `https://mymanagerworkspace.com/pricing` (same host you serve, no `www` mismatch). Status must read **Approved**.                                                                                                                                                                                                                                        |
| B2  | Price                    | Paddle > Catalog > Prices                                    | `PADDLE_PRICE_ID` is the **price** ID starting `pri_`, not the product ID starting `pro_`. $18.99, monthly, trial period 1 month, payment method required for trial.                                                                                                                                                                                     |
| B3  | API key                  | Paddle > Developer tools > Authentication > API keys         | Read and write on **Customers** and **Transactions**. Live key (`pdl_live_apikey_...`) for live.                                                                                                                                                                                                                                                         |
| B4  | Client-side token        | Same page, Client-side tokens                                | `live_...`. Already in `pricing.html` (`data-paddle-token`). It is public by design. Must belong to the same account as B3.                                                                                                                                                                                                                              |
| B5  | Notification destination | Paddle > Developer tools > Notifications                     | URL `https://mymanagerworkspace.com/api/billing/webhook`. Events: `subscription.created`, `subscription.activated`, `subscription.trialing`, `subscription.updated`, `subscription.past_due`, `subscription.paused`, `subscription.resumed`, `subscription.canceled`, `transaction.completed`. Copy the destination's **secret key** (`pdl_ntfset_...`). |
| B6  | Secrets                  | Terminal in repo root                                        | See below                                                                                                                                                                                                                                                                                                                                                |
| B7  | Environment var          | `wrangler.jsonc`                                             | `"PADDLE_ENV": "live"` (already set). Use `"sandbox"` only when everything above is from the sandbox account.                                                                                                                                                                                                                                            |

```bash
npx wrangler secret put PADDLE_API_KEY
npx wrangler secret put PADDLE_PRICE_ID
npx wrangler secret put PADDLE_WEBHOOK_SECRET
npx wrangler secret list
```

VERIFY: `secret list` shows those three names. If you re-create the notification destination, its secret changes: re-run `put PADDLE_WEBHOOK_SECRET`.

---

## 4. Phase C: Acceptance test (costs $0: month one is a free trial)

Use a **new incognito window** so no stale cache is involved. Use your own card, cancel inside the trial, pay nothing.

| Step | Do                                                                                                                                                     | Expected                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1   | Sign in at mymanagerworkspace.com                                                                                                                      | Signed-in chip shows.                                                                                                                                  |
| C2   | Open `/pricing`, click **Upgrade to Premium**                                                                                                          | Status line: "Checkout opened in a new tab". The new tab's URL contains `?_ptxn=txn_...` and Paddle's checkout overlay appears within about 2 seconds. |
| C3   | Complete checkout                                                                                                                                      | Band reads "Your payment went through...", then within about 30 seconds "You are on Premium."                                                          |
| C4   | In a second terminal during C3: `npx wrangler tail`                                                                                                    | `POST /api/billing/webhook` shows 200 for the subscription events. Paddle > Notifications shows 200 responses.                                         |
| C5   | `npx wrangler d1 execute my-manager-db --remote --command "SELECT owner_sub, ls_subscription_id, status, current_period_end FROM cloud_subscriptions"` | One row for your account. `ls_subscription_id` starts `sub_` (never `txn_`). Status `on_trial` or `active`.                                            |
| C6   | In Paddle, cancel the subscription immediately                                                                                                         | Within a minute the row's status is `canceled` and the plan pill returns to Free.                                                                      |

---

## 5. If a step fails

| Symptom                                                           | Cause                                               | Action                                                                                                                                                 |
| ----------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lands on `/pricing`, no overlay, no message                       | Stale bundle in the browser                         | Use incognito. In DevTools > Network confirm `marketing-bundle.js?v=368` loads. Application > Service Workers > Unregister.                            |
| Red band: "secure payment form could not load"                    | Content blocker or CSP blocking `cdn.paddle.com`    | Allow it for this site. Open Console, copy any CSP violation line.                                                                                     |
| Overlay opens but shows an error or domain message                | Default payment link not approved                   | Re-check B1 status in Paddle.                                                                                                                          |
| Upgrade shows "checkout creation failed (Paddle HTTP 404 or 400)" | Price from a different environment than the API key | The message names LIVE or SANDBOX. Re-check B2, B3, B7 together.                                                                                       |
| "checkout creation failed (Paddle HTTP 401 or 403)"               | Wrong or under-scoped API key                       | Re-check B3, re-run `secret put`.                                                                                                                      |
| "Sign in first"                                                   | No session                                          | Sign in, retry.                                                                                                                                        |
| Paid, but plan stays Free                                         | Webhook not landing                                 | Paddle > Notifications > delivery log. **401** = wrong secret (B5/B6). **400/500** = read `wrangler tail`. **No delivery** = wrong URL or events (B5). |

**Sandbox testing (optional):** create the same objects in a sandbox account, use a `test_...` client token in `pricing.html`, set `PADDLE_ENV` to `"sandbox"`, and put sandbox values in the three secrets. The patch already calls `Paddle.Environment.set("sandbox")` for `test_` tokens and allows `sandbox-buy.paddle.com` in the CSP. Reverse every one of those switches before taking real payments.

---

## 6. Stop conditions (agent)

- `git apply --check` fails.
- Any VERIFY line in Phase A prints something other than expected.
- `npm run verify` fails in a file this directive touched, or fails and `regen-csp-hashes.cjs` does not fix it.
- Production curl checks in A8 do not match after deploy.

On stop: report the exact command, its output, and nothing else. Do not improvise a fix.

---

## 7. Audit register

Fixed in `paddle-fix.patch` and tested (page scenarios 8 of 8, webhook scenarios 6 of 6):

| ID  | Severity | Finding                                                                                                           | File                                        |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| P1  | Critical | `_ptxn` deleted before `Paddle.Initialize` read it; checkout could never open                                     | `js/marketing.js`                           |
| P2  | Critical | Immutable 1-year JS caching with unversioned bundle URL; fixes would not reach returning browsers                 | `pricing.html`, 8 pages, `sw.js`            |
| P3  | High     | Every renewal `transaction.completed` replaced the real `sub_` ID with a `txn_` ID and wiped `current_period_end` | `src/billing.js`                            |
| P4  | High     | Paddle does not guarantee delivery order; a late old event could resurrect a cancelled plan                       | `src/billing.js`                            |
| P5  | Medium   | Events lacking our `custom_data` returned 400, which makes Paddle retry for days                                  | `src/billing.js`                            |
| P6  | Medium   | Failure banner was headed "Payment received."                                                                     | `js/marketing.js`                           |
| P7  | Medium   | Sandbox could not work: no `Environment.set`, and CSP lacked `sandbox-buy.paddle.com`                             | `js/marketing.js`, `worker.js`, `serve.cjs` |
| P8  | Medium   | Paddle.js blocked by an extension gave silence, indistinguishable from this bug                                   | `js/marketing.js`                           |
| P9  | Medium   | Plan status read once after checkout, but the webhook can land seconds later; now polls up to 30 seconds          | `js/marketing.js`                           |

Open items, not in this fix (decisions or separate work):

| ID  | Severity | Finding                                                                                                                                                                                       |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P10 | Medium   | The site promises "cancel any time" but there is no in-app cancel or manage-billing path. Buyers can use the link in Paddle's receipt email, but the app should offer it.                     |
| P11 | Decision | `past_due` (failed renewal card) drops Premium instantly. Paddle retries the card for days. Choose: immediate loss, or grace until Paddle gives up. One-line change in `billingStatusActive`. |
| P12 | Low      | Systemic version of P2: `build.js` should emit content-hashed filenames so no future edit can hit the cache trap.                                                                             |

---

## 8. Backlog: making the pricing page best in market (separate directives, after go-live)

Ranked by revenue impact per effort.

1. **Manage billing (closes P10).** `GET /api/billing/portal` returns the subscription's management URLs from Paddle. When the plan is active the page shows "You're on Premium" with a Manage button instead of Upgrade.
2. **Sign in, then resume.** If signed out, open the sign-in sheet and continue to checkout automatically. Today the buyer sees an error line and must click again. The repo already has the `queueAfterSignIn` pattern.
3. **In-page checkout.** Return `transactionId` from `/api/billing/checkout`; on the pricing page call `Paddle.Checkout.open({ transactionId })` instead of opening a new tab. Removes the popup-blocker workaround and one navigation. Keep the new-tab path for the app-side upgrade buttons.
4. **Rebuild the page as a conversion page, not a policy document.** Free and Premium side by side as two cards. One primary button above the fold labelled "Start your free month". A trust row (Paddle is merchant of record, cancel any time, 30-day refund). FAQ accordion with `FAQPage` JSON-LD. Show the live price and tax with `Paddle.PricePreview`, so buyers see their local figure before checkout. Consider an annual plan; if you add one, the "no annual plan" sentence must change with it. Keep to the repo's no-emoji, token-driven, no-inline-script rules.
5. **`GET /api/billing/config`** returning `{ token, env }` from Worker vars, so switching sandbox and live never means editing HTML.
6. **Paddle Retain** (automatic failed-payment recovery). Requires allowing `public.profitwell.com` in the Paddle CSP, which was blocked on purpose. Trade-off: one more third-party script on the checkout page versus recovered revenue. Paddle's go-live checklist also asks for `pwCustomer` in `Paddle.Initialize` when Retain is on.
