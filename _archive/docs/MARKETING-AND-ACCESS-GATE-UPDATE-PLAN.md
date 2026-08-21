# My MaNaGeR — Marketing Pages & Access-Gate Update Plan
**Scope:** Everything a prospect or a new user sees BEFORE they're inside a project —
`index.html`, `features.html`, `about.html`, `contact.html`, plus the access-code /
password gate screens in `app.html` and `admin.html`. This is a companion document to
`FIELD-GUIDE-UPDATE-PLAN.md` (which covers the in-app help guide). Same method: every
claim below is a direct quote or line-cite from the actual shipped file, not a guess.

**Why this matters as much as the guide:** the guide only reaches someone who already
opened the app. These pages are what sells it — to a client, a partner, or you
positioning it as a product. Right now they are selling an OLDER, weaker version of the
app than the one that actually exists.

---

## 1. Verdict

Same failure pattern as the field guide, in a more damaging place: **the front-facing
pages describe pre-Rank-2.3 capability as the headline AI feature**, and say nothing at
all about the things that would actually differentiate this from Procore/Autodesk/
Buildertrend/Raken — which your own `AI-VOICE-SYNC-INTEGRATION-RESEARCH.md` already
identified as the competitive landscape.

### Confirmed stale claims (verbatim from shipped code)

- **`index.html:20`** (meta description, i.e. what shows in a Google search result and
  link preview): *"...AI prompts, weather-aware scheduling, and offline-first."*
  "AI prompts" undersells a real in-browser AI engine as a copy-paste gimmick.
- **`index.html:222-223`**, hero-section feature card:
  *"AI Prompt Library — A dozen built-in prompts turn your live project data into
  weekly digests, status reports, and schedule audits — paste them into any AI you
  already use."*
  This is the exact same stale story as the guide's A-11 sheet, in your actual landing
  page. It describes the app as a prompt-copier, not a product with a working local AI
  engine and an optional cloud tier.
- **`features.html:172,180`**, features grid:
  *"AI Prompt Library"* / *"Paste into any AI you already use; your data stays in your
  hands."*
  Same issue. Also note: `features.html:3` literally has a source comment reading
  *"Liquid Glass v1.0"* — the Premium glass UI shipped and is even referenced in this
  file's own internal comment — **but the visible page copy never mentions it to a
  visitor.** You built a visual differentiator and the sales page doesn't sell it.

### Confirmed ZERO mention anywhere in marketing pages
Checked `index.html`, `features.html`, `about.html`, `contact.html` for any reference —
none found for:
- **Voice capture / offline whisper transcription** — arguably the single strongest,
  most defensible differentiator you have (per your own research doc: Raken has voice
  input, but true *offline* whisper.cpp transcription with zero cloud dependency is
  rarer). Zero mentions.
- **Claim Pack / Voice-to-Claim pipeline** — a construction-specific, high-value feature
  (claims are expensive, adversarial, and time-sensitive) with zero mention anywhere a
  prospect would see it.
- **Liquid Glass Premium UI** — shipped, referenced only in an internal source comment.
- **Multi-device sync (Rank 4.4) / optional Google backup (Rank 4.5)** — "gate the
  backup, not the app" is a genuinely good, honest positioning story (competes with
  Procore's mandatory-account model) and it's simply not told anywhere public.
- **True offline-first / PWA installability** — mentioned as a phrase ("offline-first")
  in the meta description, but never explained or demonstrated as a concrete benefit
  (e.g. "no signal on site? doesn't matter").

---

## 2. Access-gate screens ("the password look")

Two distinct gate screens exist, confirmed in code, both are a visitor's or a
teammate's literal first interaction with the product:

- **`app.html` project unlock modal** (`app.html:118-129`) — the per-project access-code
  entry a client or teammate sees. Copy: *"This project is protected. Enter the code
  your admin shared with you."* Functionally fine, visually should be checked against
  the FIX-1/FIX-2/FIX-3 glass fixes from the last code audit (Option B chromatic-
  aberration shader) to confirm the Premium glass treatment, if enabled, actually
  applies here and doesn't look like a plain/broken form.
- **`admin.html` password setup/login gate** (`admin.html:27-49, 116-122`) — your own
  personal login screen. Confirmed: it has a documented `prefers-reduced-transparency`
  fallback (`admin.html:42-49`) that correctly flattens to a solid card when glass
  effects are disabled — that part is done right. Worth a visual check of whether it
  still looks appropriately premium/branded rather than a bare unstyled password box,
  since this is the very first thing you personally see every session and, more
  importantly, the first thing a prospective client sees if you ever demo the admin
  side.

### Action
- [ ] **[VERIFY — needs a real screenshot/click-test]** Open both gate screens with
  Liquid Glass Premium toggled ON and OFF, in light and dark theme, and confirm neither
  looks like a "broken/plain form" moment — first impressions on a gated screen carry
  disproportionate weight for a client evaluating whether to trust the tool with their
  project data.
- [ ] Decide deliberately whether these gate screens should visually preview the
  product's polish (glass, branding) or stay deliberately minimal/fast — either is a
  legitimate choice, but right now it reads as unexamined rather than decided.

---

## 3. Proposed content updates — marketing pages

| Page | Section | Current state | Needed change |
|---|---|---|---|
| `index.html` | Meta description | "AI prompts" | Rewrite to name the real capability: in-browser AI engine (zero-key, offline) + optional cloud tier, offline voice capture, true offline-first PWA. |
| `index.html` | Hero "AI Prompt Library" card | Copy-paste framing | Rename/rewrite as a real feature card — working title: **"Built-In AI, Not a Middleman"** — zero-key local engine that never fabricates (traces every line to real project data), optional BYO-key cloud tier for more, one-click presets that write straight into the project. |
| `index.html` / `features.html` | — | No voice/Claim Pack section at all | **Add a new feature card/section**: "Speak It, Don't Type It" — voice capture at meetings, offline transcription (whisper runs in-browser, no cloud, no per-minute fee), and Claim Pack generation from a recorded meeting. This is your strongest, most defensible differentiator per your own competitive research — it should not be buried. |
| `features.html` | — | Liquid Glass shipped but unmarketed | **Add a visual-design feature section** showing/describing the Premium glass tier — this is a "why does this look better than a spreadsheet-with-extra-steps" selling point that costs nothing to add since it's already built. |
| `index.html` / `features.html` | — | No sync/backup story | **Add a short, honest section** built on your own "gate the backup, not the app" principle — this is a genuine trust differentiator against subscription-gated competitors: full functionality with zero account, ever; an account is only for surviving a lost/broken device. |
| `about.html` | — | Only 3 hits on the scan terms — likely fine as an "our story" page, lower priority | **[VERIFY]** — confirm it doesn't make any claims that contradict the above (e.g. describing the app as simpler/dumber than it now is). |
| `contact.html` | — | 2 hits, likely just a form | No action expected; sanity-check only. |

---

## 4. Suggested execution order

1. Rewrite `index.html`'s meta description and hero AI card first — this is the highest
   -visibility text in the entire product (search results, social link previews, first
   thing on the page) and it's currently underselling the product the most.
2. Add the Voice Capture / Claim Pack feature section to both `index.html` and
   `features.html` — biggest true gap, biggest competitive differentiator, zero
   engineering cost (feature already shipped, this is copywriting only).
3. Add the Liquid Glass / visual-design mention to `features.html` — cheap, already
   built, currently invisible to a prospect.
4. Add the sync/backup honesty section — good trust-building copy, no engineering cost.
5. Do the gate-screen visual [VERIFY] pass (Section 2) — this one needs you to actually
   look at it, not just read code, so schedule it as a real click-through rather than a
   copy edit.
6. Sanity-check `about.html`/`contact.html` last — lowest risk, lowest priority.

---

## 5. Standing instruction going forward

You asked me to flag other sections that need an update as they come up while you're
making decisions, rather than waiting to be asked each time. Going forward, whenever a
new feature or fix is discussed, I will explicitly call out if it also touches:
- the field guide (`mymanager-field-guide.html`),
- the marketing pages (`index.html`, `features.html`, `about.html`),
- or either access-gate screen (`app.html` unlock modal, `admin.html` login),

so documentation and marketing don't quietly fall behind the code again the way they
already have twice now (the AI story and the backup/sync story, in both the guide and
the marketing pages, independently).

---

*This document is a plan only. No HTML or copy has been written or edited. Every claim
above is either a direct line-cite from the shipped file or explicitly marked [VERIFY]
where a live look (not just code) is required.*
