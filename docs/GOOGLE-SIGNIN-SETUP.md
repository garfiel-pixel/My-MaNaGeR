# Google sign-in setup and the domain checklist

This is the written record of the settings that live **outside** this repo, in
the Google Cloud console. `tools/verify-google-signin.cjs` reads it on every
`npm run verify` and fails when the site's own domains and this list disagree,
so a domain change cannot silently take sign-in down.

Client ID (public, safe to ship):
`297970704704-m05hgt93lfaq286q90br8c96ffg1aph3.apps.googleusercontent.com`

## 1. How the flow works

The app uses **Google Identity Services** in popup mode, not a redirect:

1. The page loads `https://accounts.google.com/gsi/client`.
2. GIS draws the button and opens the account chooser in a popup.
3. Google hands the page an **ID token** (a signed JWT).
4. The page posts that token to `POST /api/auth/google`.
5. The Worker validates it with `oauth2.googleapis.com/tokeninfo` and sets the
   `mmgr_session` cookie.

There is **no redirect URI** in this flow, so `redirect_uri_mismatch` is not a
failure mode we can hit. The setting that matters is **Authorized JavaScript
origins**.

## 2. Authorized JavaScript Origins

The Google Cloud console (APIs and Services, Credentials, the OAuth 2.0 Client
ID above) must list every origin the app is served from.

Production:

- `https://mymanagerworkspace.com`

Local development and CI:

- `http://localhost:8765`
- `http://localhost:8787`

Do not add a trailing slash, a path, or `www` unless the site actually serves
those addresses. `www` is not a canonical origin today: every page's canonical
link, the sitemap and `robots.txt` name `mymanagerworkspace.com` only.

## 3. Adding a domain later

Do all four steps in one change, or sign-in breaks on the new address while
every static check still passes:

1. Add the origin (for example `https://www.example.com`) to Authorized
   JavaScript Origins in the console.
2. Add the same origin to section 2 of this file.
3. Make sure the served CSP still allows `accounts.google.com` (script, frame)
   and `oauth2.googleapis.com` (connect). `tools/verify-google-signin.cjs` arm
   2 checks the Worker's copy.
4. Run `npm run verify`. Arm 4 fails until step 2 is done, which is the point.

## 4. Symptoms and what they mean

| What the user sees | What it means | Where to look |
|---|---|---|
| Button is blank, nothing renders | GIS script blocked or CSP missing an origin | CSP `script-src`, network tab |
| Account chooser opens, then nothing | The console does not allow the current origin, or the Worker refused the credential | Authorized JavaScript Origins; `/api/auth/google` response |
| "Google sign in did not finish" under the button | The Worker refused the credential (401) | Worker logs, `verify-auth-worker.mjs` |
| Sign-in works, then the app forgets it | Cookie not set (HTTPS, SameSite, third-party blocking) | `Set-Cookie` on the response |

The sign-in module now prints the third row's message instead of failing in
silence. Before 2026-10-31 every refusal was invisible.

## 5. The 2026-10-24 to 2026-10-31 outage, for the record

`oauth2.googleapis.com/tokeninfo` serialises **every** claim as a string, so
`email_verified` arrives as `"true"`, not `true`. The G-2 hardening compared it
with boolean `true` and refused every real sign-in with 401. The account
chooser still opened and closed normally, so it looked like a redirect that
never happened.

The unit harness faked `email_verified: true`, so CI never saw it. It now
reproduces the real wire shape, and the five arms above plus the new
`signin:` checks in `tools/verify-auth-worker.mjs` hold it.
