# Building something new: UI quality and avoiding "AI slop"

Read this when generating a new app, page, or feature with no prior UI to
compare against — where "check the existing pattern" (the audit file) isn't
available yet, because there isn't one.

## The problem this file exists for

Asked for something "modern" or "clean" with no other constraint, an AI
defaults to the statistical average of its training data — which produces a
specific, recognizable, generic look ("AI slop"): purple-to-indigo
gradients, `Inter`/`Roboto` everywhere, three-to-six identical feature cards,
glassmorphism, soft glowing shadows, filler copy like "transform your
workflow." Nothing in it is broken. It just reads as "no one decided this."
The fix is not "try to be tasteful" — it's constraining the choice specific
enough that averaging can't happen.

## Before generating anything: pick real constraints, not adjectives

- **Anchor to a named reference, not a mood word.** "Like a Linear product
  page from late 2024" beats "modern and clean" — a model has a sharp
  picture of a specific thing and only a fuzzy one of a vague adjective.
- **Write down what's forbidden, not just what's wanted.** A short banned
  list (specific fonts, specific gradients, specific layout clichés) does
  more work than paragraphs of positive description.
- **Choose from a fixed set instead of open-ended choice.** Picking a
  palette/font pairing from a small curated list is a decision; being asked
  to "pick something nice" collapses back to the average.
- **Persist the decisions in a constraints file** (a `DESIGN.md`-style
  document: palette, type scale, spacing unit, banned patterns, the named
  reference aesthetic) rather than re-deciding per screen — this is what
  keeps a multi-screen build consistent with itself.

## The concrete system, once a direction is picked

- **Spacing: pick a base unit and stick to multiples of it** (8pt is the
  industry default — Material, Carbon, Fluent, Polaris, Primer all use it;
  it also renders on whole pixels at common screen densities). Don't
  eyeball padding values.
- **Type scale: derive sizes from a base + a ratio, don't jump straight to
  "big."** Common ratios: 1.125–1.333 for dense app/product UI (compounded
  across body → subhead → heading), larger ratios (1.5–1.618) only for a
  hero/display headline that's meant to dominate. A flat "make headings
  2–3x body size" at every level produces oversized, unbalanced hierarchy —
  reserve a big jump for the one thing that should actually dominate a
  screen, not for every heading.
- **Color: one accent, reserved.** Pick a single saturated accent color and
  spend it only on the primary action or the one number that matters most
  on a given screen. Everything else — borders, secondary text, axes,
  default icons — stays neutral. If more than one saturated color is
  competing for attention on the same screen, that's the bug.
- **Numbers: tabular figures wherever money, quantities, or any column of
  numbers appears.** Proportional numerals let digits drift out of
  alignment, making totals harder to visually verify — a bigger deal in
  anything with a budget, schedule, or dashboard than it looks.
- **One dominant decision per screen.** Something should be unambiguously
  the loudest thing on the page; everything else recedes. Competing focal
  points is what makes a screen feel undecided.
- **Decide the copy's voice before the layout.** Terse, playful, clinical —
  whichever fits — decided first, so layout follows the voice instead of
  generic feature-spec copy dictating a generic card grid.
- **Iterate by deleting.** After a first pass, name the two or three things
  that read as "AI did this" and remove them rather than adding more
  decoration on top. Whatever survives being deleted without being missed
  was slop to begin with.

## The Kano pre-ship check

Before calling a new feature or screen done, list its "of course this needs
that" companions — the things nobody will ask for but whose absence will
read as unfinished the moment someone hits them (see SKILL.md Law 1). Run
the UI-state pass and placement pass from `existing-app-audit.md` too — they
apply to new builds exactly as much as existing ones, since a freshly built
screen can be just as prone to a missing error state or an icon that fails
on a background nobody test-placed it on.
