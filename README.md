# My MaNaGeR

An offline-first construction project-management workspace that runs in the
browser. No account and no payment are required to use it; an optional account
adds cloud backup, more linked projects, project photos and the full AI
assistant. Nothing stored on your device depends on either of those.

- **Live app:** https://mymanagerworkspace.com
- **Terms of Service:** https://mymanagerworkspace.com/terms.html
- **Privacy Policy:** https://mymanagerworkspace.com/privacy.html
- **Refund Policy:** https://mymanagerworkspace.com/refund.html

## Stack

- Static front end (HTML/CSS/JS) served from Cloudflare Workers static assets.
- `worker.js` - security headers (CSP with per-script SHA-256 hashes), Google
  sign-in session (HttpOnly HMAC cookie), BYO-AI-key relay (`/api/ai/chat`),
  and the D1 + R2 cloud sync API (`/api/cloud/*`).
- D1 database (`DB` binding) and R2 bucket (`R2` binding).
- PWA: `sw.js` service worker + `manifest.webmanifest`, offline-first.

## Local development

```bash
npm install
node build.js          # build all bundles (app, launcher, admin, marketing, CSS)
node serve.cjs         # serve on http://127.0.0.1:8765
```

Use `MMGR_SERVE_PORT=8767 node serve.cjs` to run on a different port.

## Verification

```bash
npm run verify         # CSP hashes, service worker, CSS integrity, eslint, prettier, ...
```

`npm run verify` is the gate that must pass before deploy. The only known
local-only failure on Windows is the prettier check on `manifest.webmanifest`
(CRLF); CI checks out LF and passes.

## Deploy

Follow the staging recipe in `wrangler.jsonc` (never deploy from the repo
root; wrangler uploads everything and does not honor `.gitignore`):

```bash
node build.js
STAGE="$HOME/mmgr-deploy"
rm -rf "$STAGE" && mkdir -p "$STAGE"
tar --exclude='.git' --exclude='.wrangler' --exclude='node_modules' \
  --exclude='.agents' --exclude='_archive' --exclude='tmp' -cf - . | tar -xf - -C "$STAGE"
cd "$STAGE" && npx wrangler deploy
```

## License

Proprietary. See `LICENSE`. The source is published for transparency and review
only; no license to use, copy, modify or distribute is granted.
