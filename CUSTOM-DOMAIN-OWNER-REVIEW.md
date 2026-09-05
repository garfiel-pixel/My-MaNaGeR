# CUSTOM DOMAIN — OWNER REVIEW SHEET (2026-09-04)

**One decision needed from you.** Everything else in this sheet is what happens
automatically after you make it. Skim this page; the deep technical checklist
lives in `CONTINUATION-DIRECTIVE.md` (section: CUSTOM DOMAIN TRANSITION PLAN).

---

## The ask

The app is live at **`my-manager.garfieldprocis.workers.dev`** (Cloudflare-managed
subdomain). Buy a domain you own and the app moves to **`<yourdomain.com>`**.

| | |
|---|---|
| **What you do** | Pick a domain name + buy it (≈ 10 min) |
| **What it costs** | ~**$9.77/yr for .com** at Cloudflare Registrar (at-cost/wholesale, no markup, free WHOIS privacy). Other TLDs vary slightly. |
| **Where to buy** | **Cloudflare Registrar** — your site is already on a Cloudflare account, so the domain lands in the *same* account and needs **zero DNS transfer**. |
| **What happens next** | I execute the 15-step transition checklist (~1–2 h total, mostly DNS propagation waits) |
| **Downside of staying** | Emails can land in spam (no SPF/DKIM on workers.dev), `.workers.dev` looks unprofessional for B2B, some browsers suppress the PWA install prompt, Google OAuth redirect URI stays on a dev-looking host |

---

## What buying the domain unblocks

| # | Feature | Severity | Why it matters |
|---|---|---|---|
| 1 | **Email deliverability (SPF/DKIM/DMARC)** | HIGH | Right now auth/confirmation emails go through Resend's domain — with your own domain they sign as you and stop landing in spam |
| 2 | **Professional branding** | HIGH | `.workers.dev` reads as a dev URL in sales demos and client emails |
| 3 | **Google OAuth in production** | MEDIUM | Clean redirect URI; less risk of future verification friction |
| 4 | **PWA install prompt** | LOW | Some browsers refuse install prompts on `.workers.dev` |
| 5 | **Dedicated SSL cert** | LOW | Works today; custom domain gets a dedicated cert instead of shared |

---

## Your only decision: the name

Choose a name that fits the product and is available. Recommended shapes:

- **`mymanager.app` / `my-manager.app`** (short, brand-first)
- **`mymgr.app`** (abbreviation, tighter)
- **`<yourname>construction.app`** or similar if the app is branded around you
- Any `.com` you like — registrar cost is the same ~$9.77/yr

**To check availability + buy:** add the domain in your existing Cloudflare
account (Dashboard → Domain Registration → Register Domain). Pick the name there
and it shows live price + availability before you commit. No need to research
registrars — Cloudflare sells at wholesale and your account is already set up.

> If you'd rather buy from another registrar (Namecheap, Porkbun, etc.), that
> also works — you'd then point nameservers at Cloudflare (free). Slightly more
> steps, same end state. The sheet below assumes the Cloudflare Registrar path.

---

## What I do after you buy it (no further input needed from you)

1. Add the domain to the Cloudflare zone, then attach it to the Worker
   (Workers → Triggers → Custom Domains).
2. Verify DNS propagation.
3. Google Cloud Console: add the new domain as an authorized redirect URI.
4. Resend dashboard: verify the domain for sending; update `RESEND_FROM_EMAIL`.
5. Rebuild + deploy from the staging copy (`node build.js`, `npm run verify`,
   tar staging recipe).
6. Test every auth flow, email delivery, and PWA install.
7. Sweep marketing pages + field guide for hardcoded `workers.dev` references.
8. Monitor deliverability for a week; keep the old `.workers.dev` mapping until
   you say it can go.

**Code needs no changes:** the app derives its origin from `request.url`
everywhere (session links, Google OAuth, CSP, cloud API). The only hardcoded
reference — `GOOGLE_CLIENT_ID` — is domain-agnostic.

---

## Timeline

| Step | Duration |
|---|---|
| You buy the domain | 5–10 min |
| Cloudflare zone + custom-domain attach | 10 min |
| DNS propagation | 5–15 min (Cloudflare DNS) |
| Google OAuth + Resend updates | 15–35 min |
| Rebuild, verify, deploy, test | ~30 min |
| **Total (after purchase)** | **~1–2 h** |

---

*Deep checklist: `CONTINUATION-DIRECTIVE.md` → CUSTOM DOMAIN TRANSITION PLAN.
Owner-action index: `OWNER-REVIEW.md`. Tracker: `PLANNING-TODO-2026-09-03.txt` →
AREA F, item F2.*
