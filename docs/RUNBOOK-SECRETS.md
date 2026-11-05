# Runbook - secrets, history integrity and rotation

**Rule zero: a value never lives in this repository.** Not in a page, not in a
comment, not in a test fixture, not in a commit message. Everything below names
*where* a secret lives and *how* to replace it; none of it contains the secret.

Two scanners enforce the rule:

| Where | What it does |
| --- | --- |
| `.githooks/pre-commit` | `gitleaks protect --staged --config .gitleaks.toml` (falls back to `gitleaks git --staged` on newer binaries). If the binary is not installed the hook prints a visible `SKIPPED` line - it never fails silently, and CI still scans. |
| `.github/workflows/ci.yml` (`static` job) | `gitleaks/gitleaks-action`, pinned to a commit SHA, full history (`fetch-depth: 0`), same `.gitleaks.toml`. This is the gate that cannot be skipped with `--no-verify`. |

`.gitleaksignore` holds fingerprints for the known false positives only. Adding
an entry is a reviewed change: the comment next to it must say why the match is
not a credential.

---

## 1. Inventory

"Where it lives" is the Cloudflare secret store for the Worker
(`npx wrangler secret put <NAME>`), unless the row says otherwise. Nothing here
is in `wrangler.jsonc` - that file carries bindings, never values.

| Secret | Used by | Where it lives | Who can read it | Rotation | Downtime |
| --- | --- | --- | --- | --- | --- |
| `GOOGLE_CLIENT_SECRET` | Google sign-in code exchange **and** the session HMAC key (`sessionKey()` in `src/lib/http.js`) | Wrangler secret + Google Cloud console | Owner; anyone with dashboard access to either | Rotate in Google Cloud first, then `wrangler secret put`. **This one logs everyone out** - see §3. | Users re-sign-in |
| `GOOGLE_CLIENT_ID` | Google sign-in | `wrangler.jsonc` `[vars]` (public by design) | Public | Console + config | None |
| `PADDLE_API_KEY` | Billing: checkout, subscription, cancel | Wrangler secret | Owner | New key in Paddle, `wrangler secret put`, revoke the old one after one deploy cycle | None |
| `PADDLE_WEBHOOK_SECRET` | `POST /api/billing/webhook` HMAC | Wrangler secret + Paddle dashboard | Owner | Add the new secret in Paddle, deploy it, then remove the old endpoint secret | None (overlap window) |
| `RESEND_API_KEY` | Verification / reset / invite mail | Wrangler secret | Owner | New key in Resend, deploy, revoke old | None |
| `TURNSTILE_SECRET` | Server-side Turnstile verification | Wrangler secret | Owner | Cloudflare dashboard issues a new secret; deploy, then retire the old widget key | None |
| `ADMIN_CODE` | Admin gate | Wrangler secret | Owner | `wrangler secret put`; existing admin sessions keep their cookie until it expires | None |
| `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_WEBHOOK_SECRET` | Legacy storefront path (kept for compatibility) | Wrangler secret | Owner | Same pattern as Paddle | None |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions deploy / dry-run | GitHub repository secrets | Owner + GitHub org admins | New token in the Cloudflare dashboard, update the GitHub secret, revoke the old token | None |
| `.dev.vars` | Local `wrangler dev` only | Developer machine, gitignored | The developer | Copy from the dashboard when needed; never commit, never paste into a chat | N/A |

`TURNSTILE_SITEKEY` is public (it ships to the browser) and lives in
`wrangler.jsonc` `[vars]`.

---

## 2. Rotation procedure (any secret)

1. **Create the new value at the issuer.** Do not revoke the old one yet.
2. `npx wrangler secret put <NAME>` from the deploy staging copy, then deploy.
3. **Verify** the affected flow end to end (sign in, checkout, mail, admin gate).
4. **Revoke the old value** at the issuer.
5. Record the date in §5.

Rotating before deploying is the mistake that causes an outage: the live Worker
keeps using the old value until the new one is uploaded.

---

## 3. The session signing secret is `GOOGLE_CLIENT_SECRET`

`sessionKey(env)` derives the session HMAC key from `GOOGLE_CLIENT_SECRET`. There
is **no key id and no previous-secret support** in this codebase, so:

- Rotating it invalidates **every** issued session cookie at once. Every signed-in
  user is returned to the sign-in screen; nothing is lost (project data is in D1
  and R2, not in the cookie).
- If the variable is ever **absent**, the Worker generates a random per-isolate
  key. Sessions then work only while the request lands on the same isolate -
  treat a missing `GOOGLE_CLIENT_SECRET` as an outage, not a fallback.

**Zero-downtime rotation is not available today.** Plan it for a quiet window and
announce it. Adding dual-secret verification (`kid` in the payload plus a
`GOOGLE_CLIENT_SECRET_PREV` accepted during a grace window) is the change that
would make it seamless; until then, do not promise a seamless rotation.

---

## 4. History scan

The tree is clean; history is scanned by CI on every push. To reproduce locally:

```bash
gitleaks detect --config .gitleaks.toml --log-opts="--all" --no-banner
```

Run it against the whole history **and** against any tag that appeared after a
history rewrite - a rewrite removes the commit, not the object.

**A hit is treated as leaked, not as a mistake to delete.** Deleting the commit
does not un-publish the value: rotate it at the issuer first, then clean history.

---

## 5. Rotation log

| Date | Secret | Reason | Verified |
| --- | --- | --- | --- |
|  |  |  |  |

The owner fills this in. A row is only useful with the verification step from
§2 recorded next to it.
