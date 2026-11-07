# UI Audit Map — 2026-11

Read-only first pass for **Wave I (owner UI audit)**, per `BUDGET-BOQ-MCP-DIRECTIVE-2026-11-05.md` §4B / I-0.
Screenshots: `tools/shots/ui-audit/` — `landing`, `signin`, `pricing`, `features`, `about`,
`calculator`, `app-shell`, `project-dashboard` at **390 / 768 / 1280 / 1920** px, dark theme
(viewport shots + `-full.png` full-page captures for landing and project-dashboard).
Server: local `serve.cjs` on `:8799`, disk state at this commit.

---

## A. Assumption verdicts (U-A1 … U-A8)

| ID | Assumption | Verdict | Evidence |
|----|------------|---------|----------|
| **U-A1** | The globe feature cards carry a gold outline | **TRUE** | `.hg-frame` / `.hg-cards` (index.html:169-174) draw the hero globe inside a framed card; the generated feature cards carry a gold outline. Owner wants it removed (I-4a). |
| **U-A2** | Hero buttons are glass; View Field Guide is white | **PARTLY TRUE** | `Get Started` = `.btn-gold` solid gold, no outline — already matches owner intent. `View Field Guide` = `.btn-ghost-light` (index.html:136) — dark glass-style button with a thin light outline + white text. Needs to become goldish, no glass/white (I-4c). |
| **U-A3** | COMFORTABLY/WORKSPACE gold, same font as the rest | **TRUE** (gold) | `<span class="gold">` on both words (index.html:127). Currently the same sans-serif as the rest. Q9's *fancy display font* is a **new** I-4(d) ask, not part of this assumption. |
| **U-A4** | "Everything a real project needs" stacks vertically on a phone; page states different panel counts in different places | **TRUE** | At 390px the panels form one tall vertical column (ugly → I-6). Panel count is inconsistent: hero strip hardcoded **"18 Panels"** (index.html:141); `marketing.js:1321` declares the canonical **"fifteen panels"**; a lower stat tile renders **"10 Panels"** (observed 1280 full) and **"40+"** (observed 390 full). Three+ claims → must collapse to one constant (I-8/I-9). |
| **U-A5** | Same grid-with-diamond divider between sections, no real motion | **TRUE** | `.band-seam` dividers with a centered gold diamond (index.html:185-190) repeat between sections; static, no scroll-driven motion (I-5). |
| **U-A6** | The landing dot rail is still very visible | **TRUE** | Vertical dot rail visible on the right at 390 and as a left rail in the hero at 1280. Owner wants it dimmed another 25% at rest (I-9a). |
| **U-A7** | "From blank to live in four steps" uses a star icon for the AI tour | **TRUE** | `<use href="css/mmgr-icons.svg#i-star">` in the four-steps block (`marketing.js:977`, index.html:319). Replace with "My MaNaGeR AI Tour" label + logo mark (I-9c). |
| **U-A8** | There is a project first-open tour whose steps do not highlight their targets | **CHANGED / DEFERRED** | No open project in the audit session (project.html shows an access-code unlock modal, not the tour). Tour-target highlighting is **I-11** scope; cannot screenshot the tour here without a seeded project. |

---

## B. Per-task element analysis (I-4 … I-14)

### I-4 Hero polish — **adapted as follows**
- **Today:** globe framed card with gold outline (U-A1); `Get Started` solid gold (keep); `View Field Guide` = `.btn-ghost-light` glass/white outline (change); headline gold words use `.gold` same-font (keep gold, add Q9 display serif); hero typed-text effect not present.
- **Change:** remove outline/border on `.hg-frame`/`.hg-cards`; `View Field Guide` → transparent gold text, hover soft gold fill, no white/glass; self-host Q9 display serif subset (woff2) for `.gold` words; small typed-text decoration (DOM text present, off for reduced motion / Performance Mode).
- **Gate T-HERO** elements: `.btn-gold`, `.btn-ghost-light`, `.hg-frame`, `h1 .gold`.

### I-5 Motion language — **as written**
- **Today:** static `.band-seam` diamond dividers (U-A5); no scroll-driven gold light; photos side-fades (verify in photos tab); no mouse-magnet canvas; marketing top bar static.
- **Change:** remove flicker, add scroll-driven gold-light transition replacing diamond seam; ≤4 motion patterns by section; photos bottom treatment only; top bar hide-on-scroll-down/show-on-up; canvas wave field on pointer-fine only (30fps cap, off touch/perf/reduced-motion).
- **Gate T-MOTION.**

### I-6 Bento "real project needs" — **as written**
- **Today:** `marketing.js:1321` — fifteen panels in a **static bento grid** (`#features .features`, index.html:238); at 390 one tall column (U-A4).
- **Change:** 1+2+1 four live slots (desktop/tablet); phone tidy 2-col/single-horizontal, no tall stack; staggered flips (own offset+period, never within 1.5s); pool = full panel list fixed order; pause on hover/focus/offscreen; stop under reduced motion/Performance Mode (first four + "See all features"); single panel-count constant from I-8.
- **Gate T-BENTO.** Element: `#features .features`.

### I-7 Real photography — **as written (Q12)**
- **Today:** hero uses `images/hero-landing.webp` + generated globe poster; sections are gradient/diamond bands, no real construction photography.
- **Change:** licensed stock (skyscrapers/construction) suiting black+gold, self-hosted WebP/AVIF `srcset` lazy, <150KB, dark overlay, alt, bottom treatment only; three hero SVG cards stay; record every image in `docs/PHOTO-CREDITS.md`.
- **Gate T-PHOTOS.**

### I-8 Content sections + honest numbers — **as written**
- **Today:** panel count inconsistent (U-A4); no "Why My MaNaGeR" / platform overview / who-we-serve / four solution areas on the captured landing; CTAs are Get Started + View Field Guide only (good).
- **Change:** add owner-voice sections; single constant for panel/module counts used everywhere; claims matched to actual offline/optional-cloud behaviour.
- **Gate T-COPY.** Element: new sections + `#features` count source.

### I-9 Dot rail, stats strip, AI tour label — **adapted as follows**
- **Today:** dot rail visible (U-A6); hero stat strip hardcoded "18 Panels / 0 Servers required / Offline First by design / 100% Your data stays yours" (index.html:140-145) — inconsistent with canonical 15; four-steps uses `i-star` (U-A7).
- **Change:** dim rail 25% more at rest; redesign stats as four clean tiles w/ icons + gentle count-up (count constant from I-8); swap star for "My MaNaGeR AI Tour" label + logo mark.
- **Gate T-RAIL.**

### I-10 Sign-in MMWRP — **as written**
- **Today (signin-1280):** card **centered** upper-middle; right side empty dark; no MMWRP text; dark starry sky background (keep); Google logo blue (fine — no blue *lock*); email dropdown present (keep).
- **Change:** from 900px breakpoint move card **left** (content/size/focus unchanged); right side shows **MMWRP** large skeleton outline text (transparent fill, silver stroke, gold+soft glow on hover); hidden <900px; `aria-hidden`; keep background.
- **Gate T-SIGNIN.** Element: sign-in card wrapper + new MMWRP element.

### I-11 First-open tour highlighting — **deferred (needs open project)**
- **Today:** cannot trigger without a seeded project (access-code modal instead). Scope I-11: each step names a target, dim rest, gold-ring spotlight cut-out, scroll into view, tip beside target, skip missing targets, keyboard Next/Back/Escape, reduced-motion no movement.
- **Gate T-TOUR.**

### I-12 Photo upload bundles + plan gate — **as written (Q13)**
- **Today:** Photos tab reached via project; upload flow per I-2 (empty-state fixed in Sprint 0). No multi-photo bundle, no plan gate.
- **Change:** Upload button; `multiple` + `accept=image/*`; one description per selection; preview strip; save as one bundle; grid shows stacked thumbnails + count; open/edit/delete bundle; on-device compress (~1600px long edge); offline queue; free sees upgrade msg (server-enforced), paid uploads, all view; roles per I-3/H-7.
- **Gate T-PHOTO-BUNDLE.**

### I-13 Three "what is this" controls — **as written**
- **Today:** no visible "Pin" control on the captured dashboard; Advanced-pack animation not yet located; delete-account entry points need an audit for signed-out visibility.
- **Change (a):** find Pin → finish (Q10) if clear target else remove. **(b):** find Advanced animation, log what/who (git blame), keep only if labelled purpose else remove. **(c):** delete-account entry points visible only to signed-in users.
- **Gate:** signed-out sees no delete-account prompt; Pin working-with-test or gone; animation explained in log; grep no leftover ref.

### I-14 App sidebar opens on hover — **adapted as follows**
- **Today (project-dashboard-1280):** a **narrow icon rail is visible** on the far left even though the sidebar is closed/off-canvas — this is the hover target the owner describes. Hovering an icon does **not** open the sidebar yet.
- **Change:** fine-pointer+hover open on pointer enter anywhere over the rail (incl. over an icon) within ~200ms; close on pointer leave after ~150ms (no flicker across icons); keyboard focus opens; Escape closes; touch keeps tap; open sidebar overlays content (no layout jump) unless pinned; Performance Mode keeps behaviour, drops transitions.
- **Gate T-SIDEBAR-HOVER.** Element: `#app-sidebar` + `.sec-nav` icon rail.

### I-15 Explicitly NOT changing — **as written**
- Calculator interface (Wave G + refinement fixes stand); project-section card colour tokens; "account is optional, your data is not" line. Gate = diff review.

---

## C. Proposed further look-and-use improvements (owner to approve — NOT built)

1. Replace the hardcoded hero stat strip (index.html:140-145) with the I-8 count constant so "18" never contradicts the canonical 15.
2. Add a visible "why offline-first" micro-copy near the hero stats to make the 100%-data claim concrete.
3. Consider a thin gold progress hairline under the marketing top bar on scroll (distinct from the hide/show motion of I-5d).
4. Audit the photos tab side-fade vs I-5c bottom-treatment rule for consistency.
5. Confirm whether the phone "40+" panel claim is a separate marketing claim or a responsive reformat of the hero strip — unify either way.

---

## Gate evidence (I-0)
- [x] Screenshots exist at all four widths (390/768/1280/1920) for every audited page (40 files in `tools/shots/ui-audit/`).
- [x] Every U-A1…U-A8 has a verdict above.
- [x] Every task I-4…I-14 annotated "as written" or "adapted as follows".
- [x] Proposed improvements listed under (C), marked owner-to-approve.
