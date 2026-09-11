---
name: human-audit
description: >-
  Owner's walk-the-whole-site audit method for My MaNaGeR. Use before
  claiming any UI wave is done, whenever the owner says "audit", "review
  the site like a person", or when a session ships user-facing UI. It is
  the way a real user experiences every page, toggle, tooltip, theme and
  flow, and it catches the defects automated gates miss: unreadable
  tooltips, dark-mode icon blobs, labels kissing their inputs, dead
  search ordering, status lines in the wrong home.
---

# Human Audit — the owner's review walk

The owner reviews the product as a person using it, not as code. This
skill is that review, written down so every agent can run it before
calling UI work finished. It exists because automated gates kept saying
"green" while real users hit unreadable tooltips, invisible icons and
jargon walls.

## The walk (in order, every page)

1. **Land like a stranger.** Open the page fresh (cleared cache, no
   session). First 3 seconds: can you tell what this page is for?
2. **Read every label out loud.** Anything that sounds like a manual
   instead of speech is a defect (see plain-language-copy skill).
   "Your admin password is stored locally as a PBKDF2 hash" is a
   defect. "Your password stays on this device" is not.
3. **Name every element's job.** A sidebar holds navigation. A backup
   row holds backup state and its fix. A header holds identity. If an
   element sits where its job does not belong ("Not signed in" inside
   the project nav rail), it is a defect even if it looks fine.
4. **Toggle both themes, re-look at EVERYTHING.** Light, then dark.
   Every icon, badge, chip and button must stay visible and legible.
   The calculator FAB turning into a pure white blob in dark mode is
   the canonical miss. Icons must show their glyph in both themes.
5. **Hover everything hoverable.** Tooltips must be readable against
   their background. If one tooltip in the app has a solid dark
   background (the methodology definitions), every tooltip gets that
   treatment. A crystal-clear tooltip over busy content is a defect.
6. **Check spacing like a typographer.** Labels and their controls
   must not touch. Toggles sit at the RIGHT edge of their row. Where
   alignment looks wrong, compare with the best-aligned version of
   that screen in git history (the owner cites late-August layouts as
   reference) and match it.
7. **Exercise every input.** Type one letter in search: does the list
   respond (prefix-first ordering)? Change a setting: does it persist?
   Every control must visibly do something.
8. **Walk every flow end to end.** Sign in from the app section,
   create a project, open it, back it up, sign out. A flow that
   dead-ends or contradicts another page's story is a defect.
9. **Check cross-page consistency.** Signed-in state shows on all
   pages once signed in. Same toast style everywhere. Same card
   language. When two siblings disagree, the better one is the rule.
10. **Judge copy as a human.** If a sentence needs a second read, it
    is too long. If it uses an engineer's word, it is wrong.

## Rules for recording

- Record findings the way the user experienced them: what they saw,
  where, what they expected. Not stack traces.
- Screenshot or name the exact element. Vague findings produce vague
  fixes.
- severity: blocking (unreadable/unusable), ugly (wrong spacing or
  tone), polish (nice-to-have). Fix blocking and ugly in the same
  session. Polish goes in the tracker, never silently dropped.

## Relationship to other skills

- universal-ui-architect supplies the hard gates (contrast, states).
- ui-modernization supplies the modernization process.
- skeptical-code-audit supplies the verification discipline.
- This skill supplies the HUMAN pass that runs last: "would the owner
  scrolling this page on their phone at a job site be able to use it
  without thinking?"

## Minimum bar to claim a UI wave complete

- The full walk ran on every touched page, in both themes.
- Every finding from the walk is fixed, tracked, or answered in the
  directive. No silent drops.
- npm run verify + the relevant qa harnesses are green AND the walk
  found no new blocking/ugly findings.
