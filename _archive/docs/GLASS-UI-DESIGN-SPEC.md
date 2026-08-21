# My MaNaGeR — Glass UI Design Spec
### (iOS Liquid Glass materials + Android binary toggle-state language)

**Status:** Design specification. Read this fully before writing any CSS.
Every value below is a hard rule, not a suggestion — where a range is given,
it's a bounded range, not "pick anything nearby." Deviating from a stated
px/ms/rgba value without a documented reason is a spec violation, not a
style choice.

**Scope reminder (do not skip this):** this treatment applies ONLY to
controls and containers — buttons, the header/toolbar, modals/sheets, the
dashboard project cards, toggles/switches, and floating inputs. **Tables,
the WBS, the Gantt chart, budget grids, RACI matrix, and any other dense
data view stay flat, opaque, and high-contrast — no blur, no glass, ever.**
This is not a full reskin. If you catch yourself adding `backdrop-filter`
to a `<table>` or a Gantt row, stop — that's out of scope by design, not by
oversight.

---

## 0. The two source languages, and exactly what each contributes

Do not blend these indiscriminately. Each contributes a specific, bounded
piece:

- **iOS supplies MATERIAL and SHAPE:** the blur recipe, the specular rim
  highlight, squircle corners, and spring-physics press states. This is
  the "how does a surface look and move" layer.
- **Android supplies STATE:** the binary filled/inverted-vs-frosted-dark
  contrast for ON/active vs OFF/inactive toggle controls. This is the
  "how do I instantly tell if something is active" layer.

Every component spec below tells you which language governs it. Most
components are iOS-governed (material/shape only). Only toggles, switches,
and multi-state chips are Android-governed (state contrast). Do not invent
a third hybrid behavior — stick to the assignment given per component.

---

## 1. Core tokens

Add these as new CSS custom properties in `css/mmgr.css`, alongside the
existing `:root` block — **do not delete or rename the existing
`--canvas`/`--card`/`--gold`/`--green`/`--danger`/`--blue`/`--border`
tokens.** The glass system is layered on top of them, using them as its
tint source, not replacing them.

```css
:root {
  /* ---- Glass surface tokens ---- */
  --glass-blur: 20px;
  --glass-saturate: 180%;
  --glass-fill-dark: rgba(255,255,255,0.08);      /* base glass fill, dark mode */
  --glass-fill-dark-hover: rgba(255,255,255,0.12);
  --glass-fill-dark-active: rgba(255,255,255,0.16);
  --glass-rim: inset 0 1px 0 rgba(255,255,255,0.15);   /* top specular highlight — MANDATORY on every glass surface */
  --glass-rim-strong: inset 0 1px 0 rgba(255,255,255,0.28); /* used on primary/accent glass only */
  --glass-border: 1px solid rgba(255,255,255,0.10);
  --glass-shadow: 0 8px 24px rgba(0,0,0,0.35);

  /* ---- Squircle corner radii (see §2) ---- */
  --squircle-sm: 14px;   /* small controls: toggle chips, icon buttons */
  --squircle-md: 20px;   /* cards, buttons */
  --squircle-lg: 28px;   /* modals, sheets, the unlock keypad */
  --squircle-pill: 999px; /* search bars, sliders, dock-style bars */

  /* ---- Motion ---- */
  --spring-press: cubic-bezier(0.34, 1.56, 0.64, 1);   /* overshoot spring, use on release */
  --spring-in: cubic-bezier(0.4, 0, 0.2, 1);            /* press-down, no overshoot */
  --press-scale: 0.96;
  --press-duration: 90ms;
  --release-duration: 260ms;

  /* ---- Android toggle-state contrast (see §5) ---- */
  --toggle-on-bg: #ffffff;
  --toggle-on-fg: #111827;
  --toggle-off-bg: rgba(255,255,255,0.10);
  --toggle-off-fg: #e2e8f0;
}
```

**On accent color:** the glass fill tint is neutral white-alpha, NOT
Apple's system blue and NOT a new palette. Color comes from what's
*underneath* the glass (your existing `--gold`, `--green`, `--danger`,
`--blue`) showing through the blur+saturate, plus accent borders/icons
drawn in those same existing tokens. **Never introduce `#FA3C00`,
Apple-blue `#0A84FF`, or any new brand color as a glass tint** — the glass
is a material applied to your existing palette, not a palette replacement.
This is the single most important rule in this document. If a component
spec below implies a new color, it's wrong — go back to `--gold`/`--green`/
`--danger`/`--blue`.

---

## 2. Squircle corners

CSS `border-radius` alone gives you a circular-arc corner, not iOS's
continuous superellipse curve. Two acceptable approaches, in order of
preference:

1. **`clip-path` with a superellipse path** — use this on every large,
   signature glass surface (the unlock modal, the settings drawer, primary
   CTA buttons). Generate the path with an n≈4–5 superellipse formula at
   build time or hardcode a path per fixed size; don't attempt a
   percentage-based dynamic squircle in plain CSS, it's not reliably
   supported.
2. **Generous `border-radius` matched to element size** as a fallback for
   small/frequently-resized elements (chips, small icon buttons) where a
   `clip-path` per instance isn't practical. Use the `--squircle-sm/md/lg`
   values above — these are already tuned to *read* as squircle-ish at
   their intended sizes, they are not arbitrary.

**Rule:** never use a flat 4px/6px/8px corporate-flat radius on anything
touched by this spec. If it's glass, it's squircle. If it's a table or
Gantt bar, it keeps the existing flat `--radius: 8px` untouched.

---

## 3. The blur recipe (exact, do not simplify)

Every glass surface uses this exact declaration order — the saturate
boost is not optional, it is the single largest contributor to "this
looks like iOS" vs. "this looks like a foggy gray box":

```css
.glass-surface {
  background: var(--glass-fill-dark);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  border: var(--glass-border);
  box-shadow: var(--glass-rim), var(--glass-shadow);
}
```

**Fallback (mandatory — do not skip):** `backdrop-filter` is unsupported
or disabled in some environments (older browsers, some in-app webviews,
reduced-transparency accessibility settings). Provide a `@supports not
(backdrop-filter: blur(1px))` block that swaps to a solid
`background: var(--card)` — your existing flat dark card color — with the
same border/shadow. Never let a glass surface become fully transparent
with no fallback; that's a readability failure, not a graceful
degradation.

```css
@supports not (backdrop-filter: blur(1px)) {
  .glass-surface { background: var(--card); }
}
```

Also respect `prefers-reduced-transparency` and `prefers-reduced-motion`:
reduce/remove blur and skip spring animations for users who've set these
OS-level preferences. This is not optional — it's an accessibility
requirement, not a nice-to-have.

---

## 4. Motion — press physics

Every interactive glass element (buttons, toggles, cards that act as
buttons) gets this exact press behavior:

```css
.glass-interactive {
  transition: transform var(--press-duration) var(--spring-in),
              background var(--tr);
}
.glass-interactive:active {
  transform: scale(var(--press-scale));
  background: var(--glass-fill-dark-active);
}
```

On release (i.e. via a `transitionend` listener or simply relying on the
CSS transition back to `scale(1)`), the return transition should use
`var(--spring-press)` (the overshoot curve) over `var(--release-duration)`,
not the flat press-in curve — press-down is quick and linear-ish,
release-up has spring overshoot. If you're doing this in pure CSS without
JS state tracking, approximate with two transitions on `:active` vs. the
resting state using different timing functions per direction; if you need
true overshoot on release, that requires either a JS-driven class toggle
or a CSS animation keyframe rather than a plain transition — use whichever
your current build tooling supports without adding a new dependency.

**Every button in this spec must feel pressable.** If a button doesn't
visibly compress on click, it's not done.

---

## 5. Android toggle-state contrast (STRICT — this governs ALL binary controls)

This is the one place Android's language overrides iOS's. Any control
representing an ON/OFF, active/inactive, or selected/unselected binary
state uses this exact contrast pattern — **not** a simple opacity or tint
shift.

**ON / active state:**
```css
.toggle-chip.is-on {
  background: var(--toggle-on-bg);   /* solid white, NOT glass */
  color: var(--toggle-on-fg);        /* dark text/icon */
  backdrop-filter: none;             /* ON state is NOT frosted — it's solid */
  box-shadow: var(--glass-rim-strong), 0 2px 8px rgba(0,0,0,0.25);
}
```

**OFF / inactive state:**
```css
.toggle-chip.is-off {
  background: var(--glass-fill-dark);  /* frosted glass */
  color: var(--toggle-off-fg);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  box-shadow: var(--glass-rim);
}
```

**Why this matters and must not be simplified:** the ON state is
*deliberately not glass* — it's solid and inverted, exactly like the
white filled circles in the Android reference (image 4: Vibrate,
Auto-rotate, Airplane mode all show solid white-bg-dark-icon when active).
The OFF state stays frosted-dark. This binary material switch (solid vs.
glass), not a color or opacity shift, is what makes state legible at a
glance. A designer's instinct to "just dim the inactive ones 40%" is the
generic-AI-UI failure mode this spec exists to avoid — don't do that here.

**Apply this pattern to every existing binary control in the app,**
specifically:
- Theme toggle (dark/light)
- Crosshair toggle (`tglCh`)
- Lock/edit toggle (`tglLock`)
- Critical-path toggle (`toggleCritical`)
- Kanban lane filters, if rendered as chips
- Any future filter/status chip that is genuinely binary

Do NOT apply this pattern to non-binary elements (a 5-option dropdown, a
text input, a multi-select) — it's specifically for two-state controls.

---

## 6. Component specs

### 6.1 Buttons (primary, secondary, icon)
- Governed by: **iOS** (material/shape) for appearance; **§5** if the
  button is itself a toggle.
- Shape: `--squircle-md` via clip-path (or border-radius fallback per §2)
- Surface: full `.glass-surface` recipe from §3
- Primary buttons: tint the glass fill toward `--gold` at low alpha
  (`background: rgba(245,158,11,0.15)` layered under the blur) so the
  accent color visibly bleeds through, per the "vivid color under glass"
  principle from the iOS reference images — a primary button should not
  look identical to a secondary one, the gold tint is how you tell them
  apart, not a solid fill.
- Press: full `.glass-interactive` behavior from §4
- Icon buttons (the small `×` / trash / edit icons scattered through
  tables): **exempt from this spec** — those live inside flat data views
  and stay as they currently are. Only icon buttons in the header/toolbar/
  modals get glass treatment.

### 6.2 Header / toolbar
- Governed by: **iOS**
- The entire `#app-header` becomes a `.glass-surface` pinned to the top,
  `backdrop-filter` letting the page content blur behind it on scroll —
  this only works correctly if the header has `position: sticky` or
  `fixed` and the page actually scrolls beneath it; verify this before
  shipping, a glass header over a non-scrolling page is pointless.
- Corner radius: none on the header itself (it's a full-width bar,
  squircle corners don't apply to edge-to-edge bars) — but any buttons
  *inside* it keep their own squircle per §6.1.

### 6.3 Modals / sheets (the project unlock modal is the signature moment)
- Governed by: **iOS**
- Shape: `--squircle-lg` via clip-path — this is a signature element, do
  not fall back to border-radius here, take the time to do the clip-path
  properly.
- Surface: `.glass-surface`, but with a stronger fill
  (`--glass-fill-dark-hover` level, not the base) since modals sit over a
  dimmed backdrop and need more presence than an inline card.
- Backdrop: the existing dim scrim (`rgba(0,0,0,.75)`) stays, but ALSO
  gets `backdrop-filter: blur(4px)` on the scrim itself (not just the
  modal) — this is what makes the background page content feel like it's
  genuinely behind frosted glass rather than just dimmed.
- The access-code input inside the unlock modal: style it as an inset
  glass "well" — `box-shadow: inset 0 2px 4px rgba(0,0,0,0.3)` (recessed,
  not raised, since you're typing INTO it) combined with the squircle-sm
  shape, gold-tinted focus ring using the existing `--gold` token.
- The "Unlock Project" button inside: full primary-button treatment per
  §6.1, with §4 press physics — this is the single most-clicked control
  in the app, it should feel the most tactile.

### 6.4 Dashboard project cards
- Governed by: **iOS**
- Shape: `--squircle-md`
- Surface: `.glass-surface`
- On hover (desktop) AND on the existing `.pcard:hover` transform: keep
  the current `translateY(-3px)` lift, but layer `--glass-fill-dark-hover`
  underneath it, so the card both lifts AND brightens slightly — matching
  how the current CSS already does the lift, you're only adding the glass
  fill state, not replacing the transform.
- Unlocked vs locked cards: this is a legitimate use of §5's ON/OFF
  pattern — an unlocked card can use the solid/inverted treatment (subtle,
  don't overdo it — a thin solid-tinted top edge or the lock icon itself
  going from frosted-outline to solid-filled is enough; don't make the
  whole unlocked card lose its glass, that would break consistency with
  every other card).

### 6.5 Floating search / input pills
- Governed by: **iOS**
- Shape: `--squircle-pill` (fully rounded capsule, matching the iOS
  search bar in image 1 and the "Play music / Media output" pill in
  image 3)
- Use this shape specifically for: any search input, the access-code
  input if you want it pill-shaped instead of the "well" treatment in
  §6.3 (pick ONE, don't do both on the same element), and any
  single-line filter input.
- Do NOT use the pill shape for multi-line textareas (charter fields,
  notes) — those keep `--squircle-md`, a pill reads wrong on tall
  elements.

### 6.6 Sliders (if/when added — e.g. a work-week or budget-threshold slider)
- Governed by: **Android** for the track/fill contrast, **iOS** for the
  thumb material.
- Track: `--squircle-pill` shaped, frosted glass background
  (`--glass-fill-dark`)
- Filled portion: solid, NOT glass — same "ON state is solid" logic as
  §5, filled with the relevant accent token (e.g. `--gold` for a progress
  slider, `--danger` if the slider represents an over-budget state)
- Thumb: small solid glass circle with the full `--glass-rim-strong`
  highlight and §4 press physics on drag-start

### 6.7 Badges / status pills (existing `.badge` classes: active,
on-hold, completed, planning)
- Governed by: **Android** (§5 logic applies conceptually even though
  these aren't literal toggles — an "active" badge should read with the
  same solid-confidence weight as an ON toggle; a muted status like
  "on-hold" should read with the same frosted/receded weight as an OFF
  toggle).
- "active"/"completed": solid-tinted background (existing status colors),
  no blur
- "on-hold"/"planning": frosted glass, lower visual weight

---

## 7. Typography — no change

Do not introduce Roboto, Germania One, SF Pro, or any new typeface as
part of this spec. Glass is a surface/material treatment, not a
typography overhaul — keep whatever font stack `mmgr.css` already
defines. If you want to revisit typography later, that's a separate,
explicitly-scoped design pass, not bundled into this one.

---

## 8. Page-by-page application map

| File | What gets glass | What stays flat |
|---|---|---|
| `index.html` (dashboard) | Header, project cards (§6.4), unlock modal (§6.3), any search/filter input | Nothing else on this page is data-dense, so this page is the most fully "glassed" of the three |
| `project.html` | Header/toolbar (§6.2), all modals (WBS import, date import, charter upload, chart-up), buttons throughout, theme/crosshair/lock toggles (§5), badges (§6.7) | WBS table, Gantt chart, Kanban board (cards can get light glass per §6.4-style treatment IF you want — this is the one judgment call in the map, default to flat for now and revisit only if it reads well), Budget table, RACI matrix, Risk register table, all dense data grids |
| `admin.html` | Header, all its modals (`adm-cfm`, `pw-om`, `adm-conflict`, `snip-om`), buttons | Project list table |

**When in doubt about a specific element not listed here: default to
flat.** This spec is intentionally conservative in scope — it's easier to
extend glass to one more element later than to walk back a data table
that became unreadable.

---

## 9. Explicit anti-patterns — do not do these

1. **Do not apply blur to any table, Gantt bar, or data grid.** Stated
   three times in this document on purpose.
2. **Do not use opacity-only dimming for OFF/inactive toggle states.**
   Use the solid-vs-frosted material switch from §5.
3. **Do not introduce a new color palette.** Glass tints existing tokens;
   it doesn't replace them.
4. **Do not skip the specular rim highlight** (`--glass-rim`) on any
   glass surface — a blurred box without the top highlight reads as
   "foggy," not "glass."
5. **Do not use a flat `border-radius` on signature elements** (the
   unlock modal, primary CTAs) where a proper squircle clip-path is
   achievable — see §2.
6. **Do not skip the `@supports not` fallback.** A glass surface with no
   fallback is a broken surface on unsupported browsers, not a
   progressive enhancement.
7. **Do not skip `prefers-reduced-transparency`/`prefers-reduced-motion`
   handling.**
8. **Do not let this spec creep beyond §8's page map** without updating
   the map first — if you decide the Kanban board should get glass
   cards, come back and change §8 explicitly rather than doing it
   ad-hoc.

---

## 10. Testing checklist

- [ ] Every glass surface has visible top-edge specular highlight, not
      just a flat blur
- [ ] Squircle corners are visibly smoother than plain `border-radius` on
      at least the unlock modal and primary buttons (compare side-by-side
      with the current build)
- [ ] Every button compresses on press and springs back on release
- [ ] Every binary toggle in the app (theme, crosshair, lock, critical
      path) shows the solid-white-ON vs. frosted-dark-OFF contrast from
      §5 — not a color/opacity shift
- [ ] Accent color (gold/green/danger/blue) is visibly bleeding through
      glass surfaces, not replaced by a new hue
- [ ] All tables, the Gantt chart, and the RACI matrix remain completely
      unaffected — flat, opaque, same contrast as today
- [ ] Page still renders acceptably with `backdrop-filter` unsupported
      (test by disabling it via devtools or an old-browser check)
- [ ] `prefers-reduced-transparency` and `prefers-reduced-motion` are
      respected
- [ ] `node test-headless.js` still passes — this spec is visual-only and
      should not touch any state/logic module, so a failure here means
      something got tangled that shouldn't have
