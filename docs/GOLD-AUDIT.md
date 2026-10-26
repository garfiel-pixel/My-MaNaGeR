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

## 4. Old orange still in the stylesheets (listing only)

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
