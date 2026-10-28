# Gold audit - October 2026

Read-only record for the owner, produced for `REFINEMENT-DIRECTIVE-2026-10-24.md` section 5.6 step 1. Nothing in this file changes a page: it lists what is already gold, what the shared rule covers, and what is still the old orange so a later decision can be made with the numbers in front of it.

## 1. The tokens

Both stylesheets carry the same block in `:root` (`css/mmgr.css` and `css/marketing.css`): `--bullion-light #e6c547`, `--bullion #d4af37`, `--bullion-dark #aa771c`, `--bullion-deep #855811`, `--bullion-edge #f3e5ab`, `--bullion-ink #1a1a1a`, `--gold-grad`, `--gold-grad-hover`, `--gold-text-on-light #7a5a0b`.

## 2. The shared button definition (section 5.3)

| Where | Selector | What it now carries |
|---|---|---|
| `css/mmgr.css:17912` | `.btn-o`, `.btn-bullion` plus the dark-mode twins | the bullion gradient fill, ink label, bronze edge |
| `css/marketing.css:5040` | `.btn-gold`, `.btn-bullion` plus the dark-mode twins | the same gradient fill, ink label, bronze edge |

`.btn-g` is GREEN (`background: var(--green)`) and is deliberately NOT in either list. `.bcp-run` is layout only and sits on top of `.btn-g`.

## 3. Where the gold-filled buttons actually are

| Page | `.btn-o` | `.btn-g` (green, unchanged) |
|---|---|---|
| `project.html` | 27 | 58 |
| `admin.html` | 3 | 21 |
| `app.html` | 0 | 1 |
| `calculator.html` | 0 | 4 |

Marketing pages use `.btn-gold` (index, about, contact, features, pricing): one shared rule, no per-page copy.

## 4. Old orange still in the stylesheets (listing only) — SUPERSEDED by section 8 (2026-10-28): every declaration listed here has been flipped to gold; the table is kept for the record.

These are NOT buttons and were deliberately left alone: the owner rule (5.5) is that only elements already gold change, and a wash on a plain light page stays at today's opacity or lower.

| File:line | What |
|---|---|
| `css/mmgr.css:47` | --brand: #d96b27; /* primary brand orange */ |
| `css/mmgr.css:48` | --brand-hover: #c25a1b; /* brand hover state */ |
| `css/mmgr.css:49` | --brand-subtle: rgba(217, 107, 39, 0.08); /* subtle brand tint */ |
| `css/mmgr.css:51` | --gold: #d96b27; /* alias: gold = brand for backward compat */ |
| `css/mmgr.css:52` | --gold-rgb: 217, 107, 39; |
| `css/mmgr.css:64` | --gold-ink: #a84a15; |
| `css/mmgr.css:115` | label moves to the dark ink step - #1c1917 on #d96b27 = 5.07:1, matching |
| `css/mmgr.css:15150` | background: #d96b27; |
| `css/mmgr.css:15964` | --gold-accent: #d96b27; /* the brand gold returns for HOVER accents only */ |
| `css/mmgr.css:15965` | --gold-accent-rgb: 217, 107, 39; |
| `css/mmgr.css:17669` | (#d96b27) on the card's white is 3.45:1 , below the 4.5:1 floor for |
| `css/marketing.css:12` | --gold: #d96b27; /* primary brand orange */ |
| `css/marketing.css:13` | --gold-hover: #c25a1b; /* brand hover */ |
| `css/marketing.css:14` | --gold-deep: #a84a15; /* brand deep - text accent on white */ |
| `css/marketing.css:15` | --gold-rgb: 217, 107, 39; |
| `css/marketing.css:51` | --hero-glow-1: radial-gradient(120% 90% at 50% -10%, rgba(217, 107, 39, 0.28), transparent 60%); |
| `css/marketing.css:4453` | --gold-deep (#a84a15) lands at 4.09:1 - under the 4.5:1 floor for 13px |

## 5. What a later decision would cover

- Re-point TEXT uses of the old gold on light surfaces to `--gold-text-on-light` (#7a5a0b, 6.37:1 on white). `#d4af37` as words on white is 2.10:1 and must not be used for text.
- The 17 remaining orange hex declarations above: mostly theme plumbing (`--gold`, `--gold-rgb`) and one card accent at `css/mmgr.css:15136`. Renaming the token itself is a separate, owner-approved change, because 331 rules resolve through `var(--gold)`.
- The narrow-button rule (two-stop gradient under 96px) is not implementable in CSS without knowing the rendered width; it needs a class on the button itself if it is wanted.

## 6. Contrast facts recorded, not papered over

The ink label on the gradient measures 8.28:1 on the light stop, 4.45:1 on the middle stop and 2.82:1 on the deep stop. Labels are centred (near the middle stop), weight 600, with a light text shadow. No colour was invented to chase the last 0.05 of the middle stop; the owner decides if a different label colour is wanted.

## 7. What the T-GOLD gate measured, and the three decisions it forced (2026-10-27)

Section 6 above samples the gradient's three STOPS. A label is not a point. T-GOLD rasterises the **computed** gradient into a canvas at each button's real rendered size, samples every pixel under the text's own bounding box, and takes the worst one - which is what a person actually reads against.

| Gradient | Worst pixel under a real label | Verdict |
|---|---|---|
| three-stop (section 5.2 as written) | **3.19 - 3.70:1** on all 13 gold buttons | under the 4.5 AA floor |
| two-stop (`#d4af37` to `#aa771c`, the directive's narrow-button form) | **4.83 - 4.95:1** | passes |
| two-stop, hover (`#e6c547` to `#bd8522`) | **5.91 - 6.11:1** | passes |

### Decision 1: the two-stop gradient is the default for every label

The directive keeps the three-stop form as the default and prescribes the two-stop only for buttons narrower than 96 px. The measurement says the three-stop form fails AA on **every** button, narrow or wide, because the label's right-hand edge always reaches the deep end. So `--gold-grad` and `--gold-grad-hover` now carry the two-stop values, which are the directive's own stops - no colour was invented. The three-stop form is used nowhere else (4 uses in total, all in the shared button rule), so nothing was lost.

This also settles the open "narrow-button class" item: there is no narrow-button special case to implement, because every label now sits on the readable gradient. No class, no dead CSS, no runtime width measuring.

### Decision 2: gold used as words has two semantic tokens, not one

224 rules said `color: var(--gold)`. On a light page that is `#d96b27` - **3.45:1 on white**, under AA - while the same rules resolve to the white accent in dark mode, where white on near-black is exactly right. They now read one of two tokens:

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--gold-text` | `#7a5a0b` (6.37:1 on white) | the theme's `--gold` | gold words on a light or glass surface |
| `--gold-text-on-dark` | `#d4af37` | `#d4af37` | gold words on a surface that is dark in **both** themes: the marketing hero band and the site footer |

The second token exists because the gate caught the first one landing on the marketing hero at **2.74:1** (deep bronze on charcoal) and the wordmark rule being shared by a light glass header **and** a dark footer. Section 5.4 of the directive already says `#d4af37` text is fine on dark surfaces (8.32:1 on the header's `#1c1917`).

### Decision 3: borders keep the accent

The first pass of the swap also caught `border-color:`, `outline-color:`, `accent-color:` and `border-top-color:` (63 declarations) because `color:` appears inside those property names. Those are borders and native-control accents, not words; they were reverted to `var(--gold)`. T-GOLD now asserts that no rule paints gold **words** with the fill token, with a property-boundary regex that cannot repeat the mistake.

## 8. The orange is retired (owner, 2026-10-28)

Owner, on seeing the deployed gold: *"I like the gold look we got and have now, and I would like it applied to all where oranges is covered, even on the branding... I want it to persist."* Sections 4 and 5 above are therefore closed: every surviving orange declaration in the allow-list, plus several the allow-list never covered, has been flipped to the bullion gold family.

### What changed

| Surface | Before | After |
|---|---|---|
| `--brand`, `--brand-hover`, `--brand-subtle` (both blocks that carried them) | `#d96b27` / `#c25a1b` / `rgba(217,107,39,.08)` | `#d4af37` / `#bd8522` / `rgba(212,175,55,.08)` |
| `--gold`, `--gold-rgb` (both stylesheets) | `#d96b27` / `217,107,39` | `#d4af37` / `212,175,55` |
| `--gold-ink`, marketing `--gold-deep` (gold as words on white) | `#a84a15` (5.74:1) | `#7a5a0b` (6.37:1) |
| marketing dark `--gold` / `--gold-hover` / `--gold-deep` | `#e8923a` / `#f0a050` / `#ffd080` | `#d4af37` / `#e6c547` / `#e6c547` |
| `--gold-accent` + rgb (dark hover accents) | `#d96b27` / `217,107,39` | `#d4af37` / `212,175,55` |
| `body.dark-mode .calc-fab` | `background: #d96b27` (white glyph) | `background: var(--bullion)` + `color: var(--on-gold)` |
| white-on-gold labels (`.calc-fab`, `.calc-action`, `.calc-eq`, `.rm-count`, `.bcp-ai-ava`, `.btn-o` copy 1) | `--lit-white` / `--on-primary` / `--card` (2.0:1 on gold) | `var(--on-gold)` (dark ink, 8.4:1) |
| focus rings (57 mmgr + 14 marketing + one hardcoded `#e8923a`) | `outline: 2px solid var(--gold)` (1.9:1 on white) | `var(--gold-ink)` / `var(--gold-deep)` (6.37:1; white in dark) |
| `.bcp-field-custom input` border | `var(--brand)` (1.9:1 on white) | `var(--gold-ink)` (6.37:1; an input boundary owes 3:1) |
| four `color: var(--brand)` text rules (photo thumb hover light+dark, `:hover` on `.ctl-sec[data-ctl-toggle]`) | brand orange / white | `var(--gold-text)` — now measured by T-GOLD ARM 4 |
| marketing sign-in sheet hardcodes (`#e8923a`, `#f0a050`, `rgba(232,146,58,.16)`) | orange | `var(--gold)` / `var(--gold-hover)` / `#e6c547` (accents on the dark card) / `rgba(212,175,55,.16)` |
| hero glow `--hero-glow-1` | `rgba(217,107,39,.28)` | `rgba(212,175,55,.28)` (opacity unchanged) |
| globe canvas (`js/marketing-globe.js`) rim glow + home pin | `rgba(217,107,39,…)` / `#d96b27` | `rgba(212,175,55,…)` / `#d4af37` |
| hero art (`images/hero-ai-roadmap.svg`, `hero-evm-chart.svg`, `hero-schedule.svg`, `hero-globe-poster.svg`) | 17 orange fills/strokes | gold (`#D4AF37`) |

### What deliberately stays, and why

- **Semantic status colours** — `--warning`/`--amber`/`--dot-yellow` (`#e65100`), `--amber-ink` (`#c24700`), `--status-warning` (`#b4740e`), the amber ramp (`#f59e0b`/`#d97706`/`#fef3c7`/`#fcd34d`) used by late/warning chips. Amber means "due soon"; gold is identity. Recolouring a status hue to the brand hue would make an alert look like decoration.
- **Alternate palettes** — coral (`#ff6e52`/`#ff8a70`), teal (`#00838f`), magenta (`#c2185b`). Opt-in themes with their own identity; the default identity is the one that had to become gold.
- **Categorical data-viz hues** — `#f97316` as one of ten Gantt phase colours in `js/mmgr-app.js`, `#8b5cf6` siblings. A category palette needs distinct hues; that is not branding.
- **Design-spec-only tokens** — `--accent-primary: #e05624` (unused by any live rule; the comment already says the live identity stays warm gold) and the `--gold-500` amber ramp in `marketing.css`, used only by nav-dropdown chrome.

### The gate now enforces the decision

T-GOLD ARM 1 was rewritten for the retirement: nine banned values in `css/`, the eight brand values across **every other served surface** (`js/`, `src/`, `images/*.svg`, all root pages, `sw.js`), and the allow-list is **empty** — 0 orange declarations across 144 files or the gate fails. A new ARM 1b fails any rule that pairs a `var(--gold|brand)` fill with white ink (the exact bug class the flip could have introduced). ARM 2 now compares `--gold` and `--gold-rgb` byte-for-byte between the stylesheets as well. Mutation-proven on 2026-10-28: re-introducing `#d96b27` into a token fails ARM 1 and ARM 2; re-introducing it into a hero SVG fails ARM 1 (this exposed and fixed a real hole — the `//` comment stripper was eating single-line SVGs after their `xmlns` URL); pairing `.rm-count` with `#ffffff` fails ARM 1b. Each mutation restored the file byte-identical.

### The 14 orange declarations that remain

ARM 1 of T-GOLD lists them and requires a written reason for each: the `--brand` / `--gold` / `--gold-rgb` / `--gold-ink` / `--gold-accent` plumbing in both stylesheets, one hero glow wash, and `body.dark-mode .calc-fab` keeping its brand orange so its glyph stays visible. Any new orange hex fails the gate. Renaming `--gold` itself is still a separate, owner-approved change (331 rules resolve through it).

### One thing noticed, not changed

`.btn-g` is defined twice in `css/mmgr.css` (around line 2732 and line 7933) with the same declarations, so the first copy is dead. `.btn-o` is also defined twice with different `color` values (`--on-primary` then `--on-gold`). The cascade is currently harmless and the gate measures the computed result, so this is recorded for a later cleanup rather than changed inside a colour wave.

