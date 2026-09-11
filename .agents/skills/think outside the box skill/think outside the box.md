---
name: outside-the-box
description: >-
  Anticipatory completeness discipline. Notices and fixes the unstated "of
  course it needs that" gap a careful human would catch on sight — a bottle
  with no cap, a phone with no case, an icon whose text vanishes the moment
  it lands on a different background — even though nobody asked, filed a
  ticket, or wrote a test for it. Applies to BOTH improving something that
  already exists (a codebase, an app, a design) AND building something new
  from a goal (a SaaS app, a landing page, a feature). Use this any time work
  touches something visual, user-facing, or shippable — reviewing, polishing,
  auditing, or generating a UI; finishing a feature; preparing something to
  ship. Trigger phrases: "does this look finished", "review this", "anything
  missing", "polish this", "ready to ship", "build me an app/page/feature",
  "audit the design", or silence on the specific question of completeness
  that this skill exists to ask anyway.
---

# Outside the Box — anticipatory completeness

A person who sees an uncapped bottle reaches for the cap without being asked.
Nobody files a ticket for "the TV needs a remote" — it's just obviously true.
This skill is that instinct, applied to whatever is being built or reviewed:
catch the thing nobody thought to ask for, because its absence would read as
broken or unfinished, not as a missing nice-to-have.

This is a mindset, not a fixed checklist — it reads whatever it's pointed at
(an existing codebase, a fresh build, a single screen) and applies itself
differently depending on what it finds. The six laws below are the constant
part. The reference files hold the situational part — read the one that
matches the work, skip the others.

## The laws

1. **Must-be quality is invisible until it's missing.** Something can need to
   exist even though no one asked for it, if its absence would read as
   careless rather than as a missing extra. That's the test for whether a
   gap belongs on the list at all: would a person notice its *absence*, not
   just fail to request its presence.

2. **Check the placement, not just the piece.** A component being correct in
   its default, "home" context doesn't mean it's correct everywhere it
   actually gets used. Before calling something finished, find every place
   it actually renders or runs — not just the one you happened to look at —
   and check it there too.

3. **Confirm it's really missing before you touch it.** A completeness
   instinct that fires on stylistic differences instead of real gaps is
   worse than useless — it burns trust and time. Before flagging or fixing
   anything, check whether it's already handled elsewhere (a sibling
   pattern, a deliberate choice, a later step) before treating it as an
   omission.

4. **Fix it so it can't recur, not just so it stops showing.** When ranking
   fix options, prefer — in this order — eliminating the possibility of the
   gap entirely, preventing it structurally, replacing the fragile part,
   making the right way the easy way, detecting it automatically, and only
   last, patching the one instance you found. A fix that only covers the
   spot you happened to catch will resurface somewhere you didn't check.

5. **Hunt for silence, not just errors.** The gaps worth finding are the
   ones that don't throw anything: a state nobody built a screen for, a
   contrast pair nothing flags, a companion piece nobody complained about
   yet because no one's hit it. If catching something depends on someone
   happening to notice, treat that as the actual bug — not the missing
   piece itself.

6. **Ask "and then what" before calling it done.** Don't stop at "this works
   in the case I just looked at." Ask where else this gets used, who else
   hits it, and what happens the first time it lands somewhere you didn't
   picture.

## Route yourself

Read the one reference file that matches what's actually in front of you —
not all three, and not "just in case":

- **Improving or reviewing something that already exists** (a codebase, a
  shipped app, an existing design) → `references/existing-app-audit.md`
- **Building something new from a goal** (a SaaS app, a landing page, a
  feature with no prior UI to compare against) →
  `references/new-build-and-ui-quality.md`
- **Wiring completeness checks into a pipeline** so they run automatically
  instead of depending on someone remembering to check →
  `references/ci-integration.md`

If the work spans more than one of these (e.g. adding a new feature to an
existing app), read both relevant files — but still skip the one that
doesn't apply. Loading all three by default is exactly the kind of
unnecessary weight this skill argues against elsewhere.

## Self-check before calling anything finished

- For each gap raised: would its absence actually read as broken, or is
  this just unfamiliar? (Law 3 — if in doubt, go check, don't flag.)
- Did I check this in every place it actually shows up, or just the one
  screen/file I had open? (Law 2.)
- Is my fix the cheapest thing that stops this from recurring, or did I
  just patch the one instance in front of me? (Law 4.)
- Did I look specifically for things that fail without announcing
  themselves — not just things that already throw an error? (Law 5.)

## What this skill is not

It is not a license to relitigate settled style choices, invent scope, or
pad a review with nitpicks to look thorough. A finding earns its place only
if a reasonable person would call its absence a defect, not a preference.
When unsure, that uncertainty is itself the signal to verify against Law 3
before saying anything — not a reason to flag it "just in case."
