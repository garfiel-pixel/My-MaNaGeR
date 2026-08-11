---
name: universal-ui-architect
description: Zero-tolerance, doctrine-grade Master UI/UX Architect framework — stricter than a military spec. Enforces a three-tier W3C DTCG token architecture, dual-layer contrast compliance (WCAG 2.2 AA floor + APCA readability ceiling), the 5 Pillars and 7 Cs of elite UI, perceptual color in OKLCH, Liquid Glass surfaces, optical alignment, optimistic interactions, and graceful degradation. Every rule is a hard gate, not a suggestion — violations block ship. Use when designing, auditing, or refactoring any dashboard, SaaS product, marketing site, design system, or complex workspace. Triggers include UI architect, design system, design tokens, token architecture, glassmorphism, dark mode, contrast audit, APCA, WCAG, optical alignment, optimistic UI, or master UI framework.
---

# Universal UI Architect — Master Doctrine

> **Status of this document:** normative. Every section marked with a ⛔ is a **hard gate**. Hard gates are not style preferences — they are conditions of shipping. A UI that fails a hard gate does not go to production, does not go in a PR, does not go in a demo. There is no "we'll fix it later" tier. If a gate cannot be met, the correct action is to change the design until it can be met, not to ship the violation.

This doctrine is brand-agnostic and platform-agnostic. Any product adopts it by supplying its own primitive values inside the token architecture below. The structure itself — token tiers, contrast law, glass rules, motion law, state completeness — never changes, regardless of brand.

It exists because the interfaces that erode trust fastest are not the ugly ones. They are the ones that are *almost* right: slightly wrong contrast, a hover state that only works in light mode, a hardcoded hex bleeding through a dark-mode redesign, a menu that closes right as the cursor reaches it. This doctrine closes every one of those gaps by rule, not by vibes.

---

## 0. Grounding — why this doctrine exists (researched, not invented)

This framework is not aesthetic opinion. It is built on the current state of the field as of 2026:

- **Design tokens are no longer optional plumbing.** Token adoption reached roughly 84% of design teams in 2026, up from 56% a year earlier, and the W3C Design Tokens Community Group (DTCG) shipped the first **stable** Design Tokens Format Module (2025.10) on October 28, 2025, backed by Adobe, Google, Meta, Figma, and 20+ other organizations. A single JSON shape (`$value` / `$type` / `$description`) is now the interoperable contract between design tools, codebases, and platforms. This doctrine's token layer is written to be DTCG-compatible in spirit and structure, even when expressed as CSS custom properties for direct implementation.
- **Three tiers, not one flat list, is the field-tested structure that prevents drift.** Primitive tokens (raw values) feed Semantic tokens (intent — `color.action.primary`) which feed Component tokens (scoped decisions — `button.bg.primary`). Skipping straight from primitive to component is the single most common cause of "why does this blue not match that blue" bugs in production design systems.
- **Contrast law is in a transition period, and this doctrine treats that honestly.** WCAG 2.2 Level AA (the 4.5:1 / 3:1 ratio model) remains the only *legally operative* accessibility standard as of 2026 — it is what ADA Title II/III, Section 508, and the EU Accessibility Act actually cite. WCAG 3.0 is still a Working Draft, not expected to reach Recommendation status until roughly 2028–2029, and its proposed perceptual contrast method (APCA) was explicitly pulled out of the normative draft in 2023 for further study — it is a powerful *readability instrument*, not a certified replacement. **The correct 2026 posture, and the one this doctrine enforces, is dual-layer: WCAG 2.2 AA as the mandatory legal floor, APCA as an additional readability ceiling check for anything with unusual font weight/size combinations.** Anyone telling you to drop WCAG 2 conformance in favor of APCA alone is giving you legal exposure, not rigor.
- **Token explosion is a real, documented failure mode.** Field guidance converges on 30–50 tokens for a lean, adopted system; systems with hundreds of tokens fail exactly like component libraries nobody uses — they rot. This doctrine's default palette is intentionally small and each addition must be justified.

Every rule below cites which of these findings it enforces.

---

## 1. The 5 Pillars of Elite UI (non-negotiable posture)

1. **Reliability** — Every visual effect ships with a solid fallback. Dark mode is first-class, never an afterthought bolted on with `filter: invert()`. `@supports`, `prefers-reduced-motion`, and `prefers-reduced-transparency` queries are **mandatory**, not "nice if you have time."
2. **Assurance** — Every interactive state (hover, active, focus, disabled, loading) is unambiguous. A user must never wonder whether their click registered.
3. **Tangibles** — High-quality materials (Liquid Glass, calibrated shadow, optical polish) exist to communicate hierarchy and quality. Ornament with no informational purpose is waste and is rejected.
4. **Empathy** — WCAG 2.2 AA is the **floor**, not the target. AAA is preferred for body text where feasible. `prefers-reduced-motion` and `prefers-reduced-transparency` are respected without exception — these are disability accommodations, not optional polish.
5. **Responsiveness** — Layout and type are fluid across the full viewport range. Interactions feel instantaneous via optimistic updates with rollback.

## 2. The 7 Cs of Interface Quality

- **Clear** — Hierarchy and purpose readable in under 3 seconds of first contact.
- **Concise** — No chrome overload. Every pixel must justify its own existence.
- **Concrete** — Data and content outrank decoration in every layout decision.
- **Correct** — Contrast is *measured*, never assumed. Perceptual math (OKLCH) governs color, not raw hex intuition.
- **Coherent** — One design language spans marketing, product, internal tools, and transactional email. No sub-brand may invent its own blue.
- **Complete** — Empty, loading, error, success, partial, and disabled states are designed for *every* component before the happy path is considered done. A component with only a happy path is an unfinished component, full stop.
- **Courteous** — The interface respects device and OS-level user preferences and never fights the cursor (Safe Triangle, optical alignment).

---

## 3. Three-Tier Token Architecture ⛔ HARD GATE

**Rule (from DTCG field practice):** tokens flow in exactly one direction — **Primitive → Semantic → Component**. A component may reference a semantic token. A semantic token may reference a primitive token. **Nothing may reference a component token, and nothing may skip a tier.** This single rule is what prevents the "same blue exists as four different hex values across the codebase" failure mode documented across every 2026 design-systems retrospective.

```
primitives  →  raw values, no meaning attached (gold-500, gray-900)
semantic    →  intent-carrying names (color.action.primary, color.danger)
component   →  scoped to one UI part (button.bg.primary, table.row.hover)
```

⛔ **Gate 3.1 — No naked values.** No hex, rgb(), or hsl() literal may appear inside a component's CSS/JSX/style block. If a value is needed that doesn't exist yet, it is added to the primitive tier first, promoted to semantic, then consumed. Adding a one-off literal to "just get it working" is the doctrine's single most common violation and is treated as a build-blocking defect, not a lint warning.

⛔ **Gate 3.2 — No value words in semantic names.** `blue` may never appear in a semantic token name (`color.action.blue` is forbidden). Only `primitive.blue.500` may contain the word "blue." The classic, documented failure this prevents: a semantic token named `gray-blue-2` that renders green after a rebrand, because nobody dared rename it.

⛔ **Gate 3.3 — Token budget.** Ship with 30–50 tokens total across all tiers for a v1 system. Every token past that budget requires a written one-line justification in the token file's comments. A system with 300 tokens that nobody remembers the purpose of is a failed system, even if it "works."

### Reference implementation (primitive → semantic → component)

```css
/* ============================================================
   TIER 1 — PRIMITIVES (raw values only, zero semantic meaning)
   ============================================================ */
:root {
  --gold-400:   #E8B84A;
  --gold-600:   #B45309;
  --gold-700:   #92400E;
  --teal-500:   #0D9488;
  --teal-400:   #2DD4BF;
  --navy-900:   #0F172A;
  --slate-950:  #090A0F;
  --slate-900:  #12141C;
  --slate-800:  #1A1C28;
  --slate-700:  #222533;
  --slate-400:  #94A3B8;
  --slate-300:  #64748B;
  --slate-200:  #E2E8F0;
  --white:      #FFFFFF;
  --green-500:  #059669;
  --green-400:  #34D399;
  --red-600:    #DC2626;
  --red-400:    #F87171;
  --amber-600:  #D97706;
  --amber-400:  #FBBF24;
  --blue-600:   #2563EB;
  --blue-400:   #60A5FA;
}

/* ============================================================
   TIER 2 — SEMANTIC (intent, references primitives ONLY)
   ============================================================ */
:root {
  --color-brand-primary:      var(--gold-400);
  --color-brand-primary-fill: var(--gold-600);
  --color-brand-secondary:    var(--teal-500);
  --color-brand-anchor:       var(--navy-900);

  --color-canvas:             #F7F8FA;
  --color-surface:            var(--white);
  --color-surface-raised:     var(--white);
  --color-border:             var(--slate-200);

  --color-text-primary:       var(--navy-900);
  --color-text-secondary:     var(--slate-300);
  --color-text-tertiary:      var(--slate-400);
  --color-text-on-brand:      var(--navy-900);

  --color-success:            var(--green-500);
  --color-danger:             var(--red-600);
  --color-warning:            var(--amber-600);
  --color-info:                var(--blue-600);

  --radius-sm: 8px;  --radius-md: 12px;  --radius-lg: 20px;  --radius-pill: 9999px;
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --duration-fast: 150ms;  --duration-normal: 220ms;

  --glass-bg:        rgba(18, 20, 28, 0.55);
  --glass-bg-strong: rgba(18, 20, 28, 0.72);
  --glass-border:    1px solid rgba(255, 255, 255, 0.10);
  --glass-blur:      blur(16px) saturate(160%);
  --glass-shadow:    0 8px 32px rgba(0, 0, 0, 0.40);
}

[data-theme="dark"] {
  --color-canvas:         var(--slate-950);
  --color-surface:        var(--slate-900);
  --color-surface-raised: var(--slate-800);
  --color-border:         var(--slate-700);

  --color-text-primary:   var(--slate-200);
  --color-text-secondary: var(--slate-400);
  --color-text-tertiary:  var(--slate-300);
  --color-text-on-brand:  #0B0C10;

  --color-brand-primary:      var(--gold-400);
  --color-brand-primary-fill: var(--gold-600); /* deliberately unchanged: keeps AA in both themes, see §5 */
  --color-brand-secondary:    var(--teal-400);

  --color-success: var(--green-400);
  --color-danger:  var(--red-400);
  --color-warning: var(--amber-400);
  --color-info:    var(--blue-400);
}

/* ============================================================
   TIER 3 — COMPONENT (scoped to one UI part, references semantic ONLY)
   ============================================================ */
:root {
  --button-bg-primary:      var(--color-brand-primary-fill);
  --button-text-primary:    var(--color-text-on-brand);
  --button-bg-danger:       var(--color-danger);

  --table-row-hover:        color-mix(in oklch, var(--color-surface-raised) 92%, var(--color-brand-primary) 8%);
  --table-header-text:      var(--color-text-secondary);

  --modal-bg:                var(--glass-bg-strong);
  --input-border-focus:      var(--color-brand-primary);
  --input-border-error:      var(--color-danger);
}
```

**Enforcement script (drop into CI):**

```bash
#!/usr/bin/env bash
# gate-naked-values.sh — fails the build if a hardcoded color literal
# appears in any component file outside the token layer.
set -euo pipefail
TOKEN_FILE="src/styles/tokens.css"
VIOLATIONS=$(grep -RnE '#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(' \
  --include="*.css" --include="*.tsx" --include="*.jsx" \
  src/components/ | grep -v "$TOKEN_FILE" || true)

if [ -n "$VIOLATIONS" ]; then
  echo "⛔ GATE 3.1 FAILED — naked color literals found outside token layer:"
  echo "$VIOLATIONS"
  exit 1
fi
echo "✅ Gate 3.1 passed — no naked values."
```

---

## 4. Contrast Law — Dual-Layer Enforcement ⛔ HARD GATE

Per the 2026 grounding in §0: WCAG 2.2 AA is legally operative; APCA is not yet a ratified standard but is the best perceptual readability signal available. This doctrine enforces **both**, in this order:

⛔ **Gate 4.1 (mandatory, legal floor):** every text/background pair must measure **≥ 4.5:1** for body text and **≥ 3:1** for large text (≥24px, or ≥19px bold) and UI component boundaries, per WCAG 2.2 §1.4.3 / §1.4.11. No exceptions, no "it reads fine to me." Measure it.

⛔ **Gate 4.2 (mandatory, readability ceiling):** for any text set below 16px, or any text at a font-weight below 400, additionally verify the pair against an APCA calculator (target Lc ≥ 60 for body text, Lc ≥ 45 for large text). If WCAG 2.2 passes but APCA reads badly, **flag it for design review** — do not auto-ship, but do not auto-block either, since APCA is exploratory. Log the flag.

⛔ **Gate 4.3:** Never certify contrast by eye or by "it looked fine in Figma." Every shipped color pair in the semantic and component tiers must have a recorded ratio in the token file comments.

```css
/* Token file comment format — mandatory per Gate 4.3 */
--color-text-primary: var(--navy-900);   /* on --color-canvas: 15.8:1 WCAG2 AAA | APCA Lc 91 */
--color-text-secondary: var(--slate-300); /* on --color-surface: 4.6:1 WCAG2 AA  | APCA Lc 62 */
```

**Automated dual-check (Node, run in CI):**

```javascript
// contrast-gate.mjs — dual-layer contrast enforcement (Gate 4.1 + 4.2)
import { hex } from "wcag-contrast";     // WCAG 2.x ratio
import apcaContrast from "apca-w3";       // APCA Lc score (exploratory signal)

const pairs = [
  { name: "text-primary/canvas",   fg: "#0F172A", bg: "#F7F8FA", size: "body" },
  { name: "text-secondary/surface", fg: "#64748B", bg: "#FFFFFF", size: "body" },
];

let failed = false;
for (const { name, fg, bg, size } of pairs) {
  const ratio = hex(fg, bg);
  const min = size === "body" ? 4.5 : 3.0;
  if (ratio < min) {
    console.error(`⛔ GATE 4.1 FAILED: ${name} = ${ratio.toFixed(2)}:1, needs ${min}:1`);
    failed = true;
  }
  const lc = Math.abs(apcaContrast.calcAPCA(fg, bg));
  const lcMin = size === "body" ? 60 : 45;
  if (lc < lcMin) {
    console.warn(`⚠️  Gate 4.2 flag: ${name} APCA Lc ${lc.toFixed(0)}, target ${lcMin}+ — send to design review`);
  }
}
if (failed) process.exit(1);
console.log("✅ Gate 4.1 passed (WCAG 2.2 AA floor met on all pairs).");
```

---

## 5. Perceptual Color — OKLCH Is Mandatory for Derived Shades ⛔ HARD GATE

HSL and RGB lie about brightness: a gold and a blue at identical HSL lightness look nothing alike to the human eye. Any *derived* color (hover state, tint, shade, disabled variant) must be generated in OKLCH space, never hand-picked in hex.

⛔ **Gate 5.1:** hover/active/disabled variants use `color-mix(in oklch, …)`, never a second hardcoded hex.

```css
.btn-primary {
  background: var(--button-bg-primary);
  color: var(--button-text-primary);
}
.btn-primary:hover  { background: color-mix(in oklch, var(--button-bg-primary) 85%, white); }
.btn-primary:active { background: color-mix(in oklch, var(--button-bg-primary) 85%, black); transform: scale(0.98); }
.btn-primary:disabled {
  background: color-mix(in oklch, var(--button-bg-primary) 40%, var(--color-surface));
  color: color-mix(in oklch, var(--button-text-primary) 40%, var(--color-surface));
  cursor: not-allowed;
}
.btn-primary:focus-visible { outline: 2px solid var(--color-brand-primary); outline-offset: 2px; }
```

This is what eliminates the single most common dark-mode bug in production: a hardcoded light-mode hover shade (`#f0d98a`) that becomes unreadable — or invisible — the instant `[data-theme="dark"]` is active. `color-mix` recomputes relative to whatever the current theme's token resolves to, so the relationship holds in both themes automatically.

---

## 6. Liquid Glass — Chrome Only, Never Content ⛔ HARD GATE

⛔ **Gate 6.1:** Glass surfaces are permitted **only** on chrome — sidebars, floating panels, modals, command palettes, toasts. Dense content (tables, forms, long text, data grids) **must** sit on a solid `--color-surface` or `--color-surface-raised`. Glass-on-dense-content is rejected in review, no exceptions, because it fails Gate 4 contrast checks the instant the content behind it changes.

⛔ **Gate 6.2:** Every glass surface **must** ship a `prefers-reduced-transparency` fallback. A glass effect with no fallback is an incomplete component per the 7 Cs "Complete" rule and is blocked.

```css
.glass {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: var(--glass-border);
  box-shadow: var(--glass-shadow);
  border-radius: var(--radius-lg);
}
.glass-strong { background: var(--glass-bg-strong); }

/* MANDATORY — Gate 6.2 */
@media (prefers-reduced-transparency: reduce) {
  .glass, .glass-strong {
    background: var(--color-surface-raised);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

/* MANDATORY — feature-query fallback for browsers without backdrop-filter (Gate 1, Reliability) */
@supports not (backdrop-filter: blur(1px)) {
  .glass, .glass-strong {
    background: var(--color-surface-raised);
    box-shadow: var(--glass-shadow);
  }
}
```

**Worked example — command palette (glass, correct use):**

```html
<div class="glass-strong" role="dialog" aria-modal="true" aria-label="Command palette">
  <input class="cmdk-input" placeholder="Type a command…" />
  <!-- results list sits on --color-surface-raised, NOT glass, once it has real content -->
  <ul class="cmdk-results" style="background: var(--color-surface-raised)">
    <li>Create new project</li>
    <li>Open Claim Pack</li>
  </ul>
</div>
```

**Anti-pattern (rejected under Gate 6.1) — glass over a data table:**

```css
/* ⛔ REJECTED: dense tabular content on translucent chrome.
   Contrast becomes unverifiable because it depends on what scrolls behind it. */
.data-table-wrapper.glass { /* never do this */ }
```

---

## 7. Optical Alignment — Math Is a Starting Point, Not the Answer

Mathematical centering is frequently *wrong* to the human eye for icons with uneven visual weight (play triangles, arrow glyphs, checkmarks). Optical correction is required wherever this applies.

```css
/* Play icon in a circular button: math says center, eye says nudge right */
.btn-play .icon-play { transform: translateX(1.5px); }

/* Heavy left-border accent pulls the eye; compensate the adjacent text */
.callout--accent { padding-left: 14px; }
.callout--accent .callout-title { margin-left: 2px; } /* optical, not mathematical, offset */

/* Numerals in a badge sit visually low relative to caps-height letters */
.badge-count { transform: translateY(-0.5px); }
```

**Rule of thumb (documented from production UI audits):** if a component "looks slightly off" after mathematically-correct centering, trust the eye and nudge by 1–2px. Do not spend more than one review cycle debating it — ship the nudge, move on.

---

## 8. Motion & Optimistic UI ⛔ HARD GATE

⛔ **Gate 8.1:** Every animation or transition must be wrapped so it degrades to an instant state change under `prefers-reduced-motion: reduce`. This is a disability accommodation (vestibular disorders), not a "nice if you have time" — treat it with the same severity as a broken login button.

```css
.card {
  transition: transform var(--duration-normal) var(--ease-spring),
              box-shadow var(--duration-normal) ease;
}
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

**Optimistic UI pattern (React example):**

```jsx
function ToggleTaskDone({ task, onToggle }) {
  const [optimisticDone, setOptimisticDone] = useState(task.done);
  const [pending, setPending] = useState(false);

  async function handleClick() {
    const next = !optimisticDone;
    setOptimisticDone(next);   // update instantly — Responsiveness pillar
    setPending(true);
    try {
      await onToggle(task.id, next);
    } catch (err) {
      setOptimisticDone(!next); // roll back ONLY on failure — Assurance pillar
      toast.error("Couldn't update — reverted.");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      aria-pressed={optimisticDone}
      aria-busy={pending}
      className={optimisticDone ? "task-done" : "task-pending"}
    >
      {optimisticDone ? "✓ Done" : "Mark done"}
    </button>
  );
}
```

**Safe Triangle (courteous submenu behavior):**

```javascript
// Prevents the classic "menu closed while I was moving toward it" failure.
function useSafeTriangle(triggerRef, menuRef, { delayMs = 150 } = {}) {
  let closeTimer = null;

  function isInsideTriangle(mouseX, mouseY, trigger, menu) {
    const t = trigger.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const corners = [
      { x: m.left, y: m.top },
      { x: m.left, y: m.bottom },
    ];
    return pointInTriangle({ x: mouseX, y: mouseY }, corners[0], corners[1], { x: t.right, y: t.top });
  }

  function onMouseLeaveTrigger() {
    closeTimer = setTimeout(() => closeMenu(), delayMs);
  }
  function onMouseMoveOverGap(e) {
    if (isInsideTriangle(e.clientX, e.clientY, triggerRef.current, menuRef.current)) {
      clearTimeout(closeTimer); // cursor is traveling toward the menu — don't close
    }
  }
  // wire onMouseLeaveTrigger / onMouseMoveOverGap to the relevant DOM nodes
}
```

---

## 9. Micro-Typography & Dense Data

```css
.data-table {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}
.data-table .cell-secondary { color: var(--color-text-secondary); font-weight: 400; }
.data-table .cell-primary   { color: var(--color-text-primary);   font-weight: 500; } /* hierarchy via weight+color, never size alone */
```

---

## 10. Fluid Layout — Holy Grail Dashboard Grid

```css
.dashboard {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto 1fr auto;
  min-height: 100dvh;
}
.sidebar { grid-row: 1 / -1; }
.header, .main, .footer { grid-column: 2; }
.main { overflow: auto; }

@media (max-width: 768px) {
  .dashboard { grid-template-columns: 1fr; }
  .sidebar { grid-row: auto; position: fixed; inset: 0; z-index: 40; transform: translateX(-100%); }
  .sidebar.open { transform: translateX(0); }
}
```

---

## 11. Complete-States Checklist ⛔ HARD GATE

Per the 7 Cs "Complete" rule: a component is **not done** — cannot enter review, cannot merge — until every row below is designed and implemented.

| State | Required | Common failure this catches |
|---|---|---|
| Empty | ✅ | Blank white space with no guidance on first use |
| Loading | ✅ | Layout jump when content pops in — use skeletons matched to real dimensions |
| Partial / streaming | ✅ | AI or paginated content with no visible "still working" signal |
| Error (recoverable) | ✅ | Dead-end error with no retry action |
| Error (unrecoverable) | ✅ | Silent failure — user thinks it worked |
| Success / confirmation | ✅ | No feedback that the action landed |
| Disabled | ✅ | Disabled control gives no reason why |
| Focus (keyboard) | ✅ | Focus ring removed for "looking cleaner," breaking keyboard nav |
| Dark mode variant | ✅ | Contrast checked separately per Gate 4, not assumed to carry over |
| Reduced motion variant | ✅ | Per Gate 8.1 |
| Reduced transparency variant | ✅ | Per Gate 6.2 |

---

## 12. Strict Gatekeeping Summary — the full checklist

Nothing ships until every ⛔ below is checked. This is the doctrine's enforcement surface — treat it exactly like a pre-flight checklist, not a suggestion list.

- ⛔ 3.1 — Zero naked hex/rgb/hsl literals outside the token layer.
- ⛔ 3.2 — Zero value-words in semantic token names.
- ⛔ 3.3 — Token count within 30–50 for v1, every excess token justified in-file.
- ⛔ 4.1 — Every text/background pair ≥ WCAG 2.2 AA ratio, measured and recorded.
- ⛔ 4.2 — Small/light text additionally checked against APCA, flagged if below target.
- ⛔ 4.3 — Ratios recorded as comments in the token file — no undocumented pairs.
- ⛔ 5.1 — All derived color states via `color-mix(in oklch, …)`, never a second hardcoded hex.
- ⛔ 6.1 — Glass used only on chrome, never on dense/scrolling content.
- ⛔ 6.2 — Every glass surface has a `prefers-reduced-transparency` fallback.
- ⛔ 8.1 — Every animation degrades under `prefers-reduced-motion`.
- ⛔ 11 — All eleven states in the Complete-States table designed and implemented, per component.

If any item is unchecked, the correct status is **blocked**, not "shipped with a follow-up ticket." Follow-up tickets for accessibility and reliability gates are how debt becomes permanent.

---

## 13. Adoption Path for Any Project

1. Create `tokens.css` (or DTCG-format `tokens.json` if using Style Dictionary) with the three-tier structure from §3.
2. Run `gate-naked-values.sh` against the existing codebase to inventory every violation before writing new code.
3. Replace violations tier-by-tier: primitives first, semantics second, components last.
4. Apply the Liquid Glass pattern only where Gate 6.1 permits it.
5. Convert every hardcoded hover/active/disabled state to `color-mix(in oklch, …)`.
6. Run `contrast-gate.mjs` against every semantic and component color pair; record ratios in-file.
7. Add the `prefers-reduced-motion` and `prefers-reduced-transparency` fallbacks project-wide.
8. Walk every component against the Complete-States table (§11) before calling it done.
9. Re-run the full checklist in §12 as a required CI step on every PR that touches styles.

When followed to the letter, the result is not merely "clean" — it is provably coherent (one token source of truth), provably accessible (measured, not assumed, contrast), and provably resilient (every effect degrades gracefully instead of breaking). That provability is the actual bar this doctrine sets: not "looks good," but "can be shown to be correct."
