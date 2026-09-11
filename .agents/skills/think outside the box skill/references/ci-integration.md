# Wiring completeness checks into CI

Read this when the goal is to make a completeness check run automatically on
every change, instead of depending on someone (human or agent) remembering
to look — the direct, mechanical extension of SKILL.md Law 5 ("hunt for
silence"): the best fix for "this depends on someone noticing" is a check
that notices for them, on every pull request, before merge.

## Visual regression testing

Catches unintended pixel/layout drift between commits by comparing
screenshots against an approved baseline, so a change that visually breaks
something gets flagged even if nothing threw an error.

- **Chromatic** — built by the Storybook maintainers; the natural fit if the
  project already uses Storybook; now also offers component-level
  accessibility regression via axe-core.
- **Percy** (BrowserStack) — cross-browser, integrates directly into GitHub
  PRs.
- **Applitools** — AI-based diffing that ignores meaningless render noise
  (font antialiasing, sub-pixel shifts) while still catching real layout
  breaks.
- **BackstopJS / Happo** — lighter, open-source alternatives when a paid
  subscription isn't justified yet.

## Automated accessibility scanning

The mechanical, always-on version of the contrast checklist in
`existing-app-audit.md` — instead of a manual pass over every icon/text
placement, this catches contrast, ARIA, and keyboard-nav problems on every
change automatically.

- **axe-core** — the engine several of the tools above embed directly; can
  also run standalone in a CI step against built HTML.
- **Lighthouse**, **Pa11y**, **WAVE** — additional automated scanners, any
  of which can run in a CI job without a paid subscription.

## Where this goes in the pipeline

The consistent pattern across teams that do this: wired into PR-level CI,
not a manual/weekly task. The value is specifically catching a regression
*before* merge — matching Law 5 directly: a check that only runs when
someone remembers to run it is the same silent-failure shape as the gaps
this skill exists to catch in the first place.

## Minimal version, if a full paid toolchain isn't justified yet

A lightweight `axe-core` pass against built HTML in an existing CI job costs
little to add and directly automates the contrast checklist from
`existing-app-audit.md` §2 — a reasonable first step before investing in a
full visual-regression subscription.
