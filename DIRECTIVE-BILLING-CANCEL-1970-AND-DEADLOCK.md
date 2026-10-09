# DIRECTIVE: BILLING (1970 DATE, CANCEL, ORPHANED SUBSCRIPTIONS) + ENDING THE TERMINAL DEADLOCK

Applies to the `mymanager-fixed` repo and the live Worker `my-manager`.
Delivered with this file: `billing-fix.patch` (sha256 in section 3). Do not edit it. Do not hand-write the changes it contains.

**Where the patch lives:** keep `billing-fix.patch` in the folder ABOVE the repo (so it is `../billing-fix.patch` from the repo root). `.assetsignore` does not exclude `*.patch`, so a copy inside the repo would be published to the internet as a static asset. This directive (`.md`) may sit in the repo root; `*.md` is excluded from the deploy.

---

## 0. HARD RULES (they override your habits; breaking one means stop and tell the owner)

1. **Never ask the owner for a cookie, session token, API key, password or any secret, and never print one.** Nothing in this directive needs one. The session cookie already pasted in this thread is treated as exposed (section 1).
2. **Every factual claim quotes the command output that proves it.** No "I confirmed", no row counts, no dates, no "the file says" without the verbatim lines. If you did not run it, say "not checked".
3. **Two failed attempts at the same approach = stop that approach.** Use the tool this directive names. Do not invent a third parser, a fourth query, or a workaround.
4. **Touch only the files named here.** Never edit `dist/` by hand. Never edit `billing-fix.patch`.
5. **No production writes** (D1 UPDATE/DELETE, secret changes, Paddle changes) unless a step below says so AND the owner replied with the exact word YES to the exact statement shown. `tools/d1-remote.cjs` is read-only by construction; use it.
6. At an **OWNER STEP**, print exactly what the owner must do, then wait. Do not do an owner step yourself.
7. Run steps in order. A step that ends in a check does not proceed until the check matches.

## 1. WHAT IS ESTABLISHED (verified against the code and the live rows you printed)

| # | Fact | Evidence |
|---|---|---|
| 1 | "Premium until Jan 21, 1970" is **seconds read as milliseconds**. The stored value `1794154608` is **2026-11-08T16:16:48Z**. Read as ms it is 1970-01-21. The database is right; the display is wrong. | `new Date(1794154608)` = 1970-01-21T18:22:34Z, `new Date(1794154608*1000)` = 2026-11-08T16:16:48Z. `src/billing.js` returned the number as-is; `js/mmgr-billing-manage.js` fmtDate did `new Date(value)`. |
| 2 | The webhook **is writing correct rows.** Row `rowid 5`: owner `118128564657302334748`, `sub_01m4e4v5652cz8vsgsz0eeaq96`, `active`, `enterprise`, real period end. A real sub_ id, a real period end and the correct tier mean the notification destination, the signature secret and `custom_data.sub` all worked for that event. | Your own `wrangler d1 execute --remote` output. |
| 3 | So the earlier hypotheses "webhook not delivering", "transaction id stored instead of sub id", "custom_data missing" are **refuted for that row.** Do not chase them. | Same row. |
| 4 | The cancel error text "not found by the LIVE API" is produced by `handleBillingCancel` when Paddle's **live** API answers 404/400 for the stored id. It says: the live API does not know that subscription (or the key cannot see it). Whether that is a sandbox/live split, a key-scope problem or a wrong account is **not yet known**. Section 5 decides it with evidence. | `src/billing.js` cancel branch. |
| 5 | Pre-patch, the app can **orphan a paying subscription**: the table keeps one row per owner and `applySubscription` overwrites it, so a second checkout creates a second Paddle subscription that bills separately but is invisible and uncancellable from the app; and cancelling the old one fires `subscription.canceled` for the OLD id, which overwrote the row and revoked Premium on the live one. | `applySubscription` upsert on `owner_sub`; no guard in `handleBillingCheckout`. |
| 6 | The two tests named "billing cancel error ..." never called the handler. They copy an `if` statement into the test body, so they pass whatever the handler does. | `test/billing.test.mjs` before the patch. |

**Claims in the previous terminal transcript that are FALSE. Disregard them:**

- "A valid mmgr_session has 3 segments, so a 2-segment cookie is invalid." **False.** `signSession` returns `base64url(payload) + '.' + base64url(signature)`: exactly **2** segments (`src/lib/http.js` lines 107-111; `readSession` splits on the first dot, lines 122-123). The cookie in the file has the correct shape.
- "The cookie decodes to the wrong account." **False.** Its `sub` `118128564657302334748` is the same `owner_sub` as the active enterprise row.
- "The table has 8 rows." Four distinct `current_period_end` values were printed, so it has 4 rows. `Rows read: 7` is D1 read accounting, not a row count.
- "A note in sw.js from Dec 2026." The note is v368 dated 2026-10-05. There is no December note.
- "The wrangler output is unparseable / ROWS=0." The cause is in your parser: the first `[` in the output is the `[WARNING]` line, and the JSON is an **array** (`[ { "results": [rows] } ]`), so `j.results` on the outer array is `undefined`. `tools/d1-remote.cjs` handles both. Use it.
- "The curl returned 'invalid project or owner code', so the cookie is bad." That string is `cloudForbidden()` = the session was not accepted for that request. It proves nothing about billing. Stop using curl with cookies.

## 2. SECURITY FIRST (5 minutes)

2a. **OWNER STEP.** A live session cookie for the owner account is in two places: `mymanagerworkspace.com_cookies.json` in the project root, and the chat transcript. Its payload carries `exp` = **2026-10-15T16:11:53Z**. The owner must **sign out of the app in the browser** that cookie came from (signing out revokes that session id server-side: `handleAuthLogout` writes `revoked_at`, effective within about 60 seconds) and then sign back in. Wait for the owner to say done.
2b. Delete the file: `rm -f mymanagerworkspace.com_cookies.json`. Check: `ls mymanagerworkspace.com_cookies.json` must say "No such file".
2c. Check history is clean: `git log --all --oneline -- mymanagerworkspace.com_cookies.json` must print nothing. If it prints anything, STOP and tell the owner (a purge of git history is a separate decision).
2d. Add `*cookies*.json` and `*cookies*.txt` to `.gitignore`, and `*cookies*` to `.assetsignore` (`*.json` and `*.txt` are already excluded from the deploy, but ignoring by name too means a rename cannot leak it). Also add `*.patch` to `.assetsignore`. Check: `git diff -- .gitignore .assetsignore` shows only those added lines (`.assetsignore` may also show line-ending noise; see F4).

## 3. APPLY THE PATCH

3a. Integrity: `sha256sum ../billing-fix.patch` must print exactly
`0ceb031907d9cec14e233917abd5368fd6c52ddc53724e4de78a0cc65e864973`
Any other value: STOP.
3b. `git apply --stat ../billing-fix.patch` must list exactly these 6 paths: `src/billing.js`, `js/mmgr-billing-manage.js`, `test/billing.test.mjs`, `test/billing-tools.test.mjs`, `tools/d1-remote.cjs`, `tools/diag-paddle-sub.cjs`. Then `git apply --check ../billing-fix.patch` must succeed. If the check fails once, the one permitted fallback is `git apply --check --ignore-whitespace ../billing-fix.patch` (line-ending differences). If that also fails, STOP and show the error. Do not hand-edit.
3c. `git apply ../billing-fix.patch` (add `--ignore-whitespace` only if 3b needed it). Check: `git status --short -- src js test tools` shows those same 6 paths (3 modified, 3 new as `??`). Other files in `git status` that were already modified before this step are expected; do not touch them.
3d. Run, and quote the last lines of each:
`npm test` (required: `# tests 34`, `# pass 34`, `# fail 0`)
`npm run verify:prettier` (required: "all matched files use Prettier code style")
`npm run verify:registry` (required: `TEST REGISTRY PASS`)
`npm run verify:eslint` (required: `0 errors`)

What the patch does (so you can explain it, not so you can redo it):

| Change | Why |
|---|---|
| `periodEndIso()`; status and cancel responses return `currentPeriodEnd` as an ISO-8601 UTC string, never a bare number, never 1970 | Removes the unit mix-up at the API. Missing or zero becomes `null`. |
| `fmtDate` in `mmgr-billing-manage.js` treats a bare number below 1e11 as seconds | Belt and braces if any other caller sends a number. |
| `applySubscription` ignores an **inactive** event (canceled/paused) about a subscription id that is NOT the one the owner row currently holds as active, and no longer sends the "cancelled" email for it | Cancelling a duplicate in the Paddle dashboard can no longer revoke the live subscription. Two simultaneous active subs log a warning. |
| `handleBillingCheckout` answers **409** `code: already_subscribed` with a plain message while an active `sub_` subscription exists; Paddle is not called | Stops the second, uncancellable subscription at the source. |
| Cancel failures keep Paddle's `error.code` in the message and log, e.g. `[subscription_locked_pending_changes]` | Distinguishes "unknown subscription" from "already scheduled to cancel" from "key lacks scope". |
| 14 new tests in `test/billing.test.mjs` (2 pure, 12 that call the real handlers with a fake D1, a fake Paddle `fetch`, and a genuinely signed session and webhook). The two vacuous tests are removed. Verified: 5 of the new tests fail against the old code. | The behaviour is now pinned. |
| `tools/d1-remote.cjs` (read-only D1 reader), `tools/diag-paddle-sub.cjs` (which Paddle environment holds a subscription or price id), 6 tests in `test/billing-tools.test.mjs` | Ends the deadlock. |

## 4. SHIP IT

4a. `sw.js`: change `const CACHE = 'mmgr-shell-v382';` to `'mmgr-shell-v383'` and add a `// v383 -` entry at the front of the comment list: billing dates were returned as epoch seconds and rendered as 1970 (now ISO strings), duplicate-subscription guard on checkout, webhook ignores inactive events for a non-current subscription id, cancel errors carry Paddle's error code. (Required: the served bundle `dist/admin-bundle.js` contains `mmgr-billing-manage.js`.)
4b. `npm run build` then `npm run verify` (required: exit 0; quote the final lines).
4c. Deploy with **the same staged-copy procedure used for the previous deploy**. Do not change it. (The staged copy has no `tmp/` directory; do not redirect output there.) Quote the new deployment id.
4d. **OWNER STEP.** In the browser: hard refresh (Ctrl+Shift+R), open the dashboard signed in as the enterprise owner. Expected: the plan badge reads **"Premium until Nov 8, 2026"** (not 1970). Report what it shows.
4e. **OWNER STEP.** While signed in with an active subscription, press Upgrade / Get a plan. Expected: the message "You already have an active subscription. Cancel it from your dashboard first ..." and no Paddle checkout opens.

## 5. DIAGNOSE THE CANCEL FAILURE (decides it with evidence, no cookie, no guessing)

5a. Read the real rows. Run exactly:
`node tools/d1-remote.cjs "SELECT rowid, owner_sub, ls_subscription_id, status, tier, current_period_end, created_at, updated_at FROM cloud_subscriptions ORDER BY rowid"`
Quote the full output. The first line is `ROWS=N`; that N is the row count. Do not write any other number.

5b. Capture the real failing call. Start `npx wrangler tail my-manager --format pretty --search "billing cancel"` in a background terminal. **OWNER STEP:** the owner presses Cancel once in the dashboard. Quote the single log line `billing cancel failed: subId=... env=... http=... detail=...` and the error text shown in the UI. If no line appears, say so and stop (the request never reached Paddle).

5c. **OWNER STEP** (the owner runs this in their OWN separate terminal so no key enters this session; the owner pastes back only the lines it prints, which contain no keys). Replace the ids with the subscription id from the tail line in 5b and the owner's `PADDLE_PRICE_ID` / `PADDLE_ENTERPRISE_PRICE_ID` values (price ids are not secret; they are in the Paddle dashboard under Catalog):
```
export PADDLE_API_KEY_LIVE=<paste in your own terminal>
export PADDLE_API_KEY_SANDBOX=<paste in your own terminal, or leave unset>
node tools/diag-paddle-sub.cjs sub_01m4e4v5652cz8vsgsz0eeaq96 pri_<live price id> pri_<enterprise price id>
```
Each id prints one `VERDICT:` line. A key you do not have can be left unset; that environment prints "skipped".

5d. Decide using ONLY this table. Quote the verdict lines and the tail line, then state which row applies.

| Evidence | Meaning | Action |
|---|---|---|
| sub verdict `LIVE`, tail `http=409` and code `subscription_locked_pending_changes` | Paddle already has a scheduled change on it, most likely it is **already set to cancel**. Not a failure. | Report it as such. No code or config change. (Showing "cancelling on <date>" needs a stored `scheduled_change`; that is deferred item F1, owner decision.) |
| sub verdict `LIVE`, tail `http=403` or message "rejected the API key" | The Worker's `PADDLE_API_KEY` lacks `subscription.write`. | **OWNER STEP:** Paddle > Developer tools > Authentication: give the key subscription write permission. No code change. |
| sub verdict `LIVE`, tail `http=401` | `PADDLE_API_KEY` in the Worker is not a live key. | **OWNER STEP:** `npx wrangler secret put PADDLE_API_KEY` and paste the live key at the prompt, in the owner's own terminal. |
| sub verdict `LIVE` but tail shows `404` | Impossible with one account: the Worker's key belongs to a different Paddle account than the key used in 5c. | **OWNER STEP:** re-put `PADDLE_API_KEY` with the same key used in 5c. |
| sub verdict `SANDBOX ONLY` | The subscription was created in Paddle **sandbox** while the Worker talks to live. The Worker has ONE webhook secret and each Paddle environment has its own, so for sandbox events to have verified, the secret in the Worker is the sandbox one; **live purchases would then never write a row.** This is a go-live blocker. | Go to section 6. Do not change anything yet. |
| sub verdict `NOT FOUND` in every environment you supplied a key for | Wrong account, a deleted subscription, or a stale row. | **OWNER STEP:** open the customer in the Paddle dashboard and read the subscription id shown there. Report both ids. If they differ, the one-time correction below applies. |
| price verdicts differ from where the sub lives | Price ids are from the other environment. | Section 6. |

One-time row correction (ONLY after the owner replies `YES update rowid <n> to <sub_id>` with the id read from the Paddle dashboard):
`npx wrangler d1 execute my-manager-db --remote --command "UPDATE cloud_subscriptions SET ls_subscription_id='<sub_id>' WHERE rowid=<n> AND owner_sub='<owner_sub from 5a>'"`
Then re-read the row with 5a and quote it.

## 6. ENVIRONMENT AGREEMENT (only if 5d sent you here)

Everything below must be in the SAME Paddle environment. Verified from the repo today: `PADDLE_ENV` = `"live"` in `wrangler.jsonc`, and `pricing.html` carries a `live_...` client token. Check the rest and report each as live or sandbox, with evidence:

| Item | Where | Live looks like | Sandbox looks like |
|---|---|---|---|
| `PADDLE_ENV` | `wrangler.jsonc` var | `live` | `sandbox` |
| Client token | `pricing.html` `data-paddle-token` | `live_...` | `test_...` |
| `PADDLE_API_KEY` | Worker secret (name only; never print the value) | starts `pdl_live_apikey_` | starts `pdl_sdbx_apikey_` |
| `PADDLE_WEBHOOK_SECRET` | Worker secret, copied from that environment's notification destination | live destination | sandbox destination |
| `PADDLE_PRICE_ID`, `PADDLE_ENTERPRISE_PRICE_ID`, `PADDLE_COMPANY_PRICE_ID`, `PADDLE_ESTIMATOR_PRICE_ID` | Worker secrets | prices that `diag-paddle-sub.cjs` reports `LIVE` | reported `SANDBOX ONLY` |
| Notification destination URL | Paddle dashboard | `https://my-manager.garfieldprocis.workers.dev/api/billing/webhook` | same URL, sandbox dashboard |

`npx wrangler secret list` shows secret NAMES only; run it to prove which exist. Then **OWNER STEP**: the owner decides the target environment and corrects whichever rows disagree, each with `npx wrangler secret put <NAME>` in their own terminal. After any secret change, redeploy and repeat 4d, 4e and 5b.

## 7. ORPHAN SWEEP (money; do this even if everything else is fine)

Before the patch, every extra checkout created an extra billing subscription that the app could not see. **OWNER STEP**, in the Paddle dashboard, in BOTH environments: list subscriptions for the owner's customer email(s). The database holds one subscription id per owner (from 5a). Any other `active` or `trialing` subscription for the same customer is an orphan that will keep charging (or start charging when its trial ends). Cancel each orphan in the dashboard. Thanks to the patch, cancelling an orphan will no longer revoke the live one (the webhook ignores it and logs `billing: ignored canceled event for <id> ...`). Report the count found and cancelled per environment.

## 8. DEFERRED. Found, real, NOT part of this change (each needs an owner decision; list them, do nothing)

- F1. The webhook does not store Paddle's `scheduled_change`. After a successful cancel the dashboard still shows "Premium until X" with a Cancel button and cannot say "cancelling on X". Needs a new column (migration), webhook change and UI change.
- F2. There is no plan-change path. Moving contractor to enterprise needs Paddle's subscription update API; the new 409 means that for now the user must cancel first.
- F3. ESLint ceiling headroom is **37** warnings (4563 of 4600). A few more warnings will fail `verify:eslint` and block the build. Decide whether to lower the warning count or raise the ceiling.
- F4. `.assetsignore` and `.nvmrc` show as modified but differ from HEAD **only in line endings** (`git diff --ignore-space-at-eol -- .assetsignore .nvmrc` prints nothing). It is noise in a security-relevant file. If that command prints nothing, `git checkout -- .assetsignore .nvmrc` is safe; if it prints anything, do not touch them and report.

## 9. REPORT FORMAT (when done, and nothing else)

One block per section 2, 3, 4, 5, 6, 7: status (DONE / WAITING ON OWNER / BLOCKED), the quoted evidence lines, and for anything not run: "not checked". No narrative, no apologies, no new theories.
