# Existing-app / existing-codebase completeness audit

Read this when improving, reviewing, or fixing something that already
exists. Pair it with Laws 2, 3, and 5 from SKILL.md — this file is the
concrete checklist those laws point at.

## 1. The UI-state pass

For every screen or component that shows data, confirm all of these exist
and are visually distinct from each other — not just "handled in code,"
actually distinguishable on screen:

- **Loading** — a skeleton or spinner, never a blank that looks identical to
  "confirmed empty" (showing "empty" before loading finishes is its own bug:
  it reads as broken for the second it's wrong).
- **Empty** — genuinely nothing there yet; explains why and offers one clear
  next action.
- **Partial** — some but not all data/setup present; shows progress, not
  silence.
- **Error** — something failed; says what, and offers a way to recover.
  Never a generic "an error occurred" with no path forward.
- **No-results** — a filter/search legitimately returned nothing; distinct
  from "empty," since the fix is "change your filter," not "add your first
  item."

## 2. The placement pass (contrast, and anything else that's "fine at home")

Any reusable visual element (icon, badge, label, chip) can be internally
consistent and still fail the moment it lands somewhere its author didn't
picture. Don't just check it in its default spot — enumerate every actual
background/container it renders on across the app and re-check it there.

Concrete numbers to check against (WCAG 2.x, Level AA):
- Normal text vs. its background: **4.5:1** contrast minimum.
- Large text (≥24px, or ≥18.5px bold): **3:1** minimum.
- Icons/graphical objects required to understand the content, vs. whatever
  is *adjacent* to them (not just their own internal colors): **3:1**
  minimum — check this on every background the element is actually placed
  against, since a graphic can need two separate contrast checks (icon vs.
  its own backdrop, backdrop vs. whatever it's sitting on).

The general version of this check (not just contrast): if a component has a
"home" appearance that was only ever visually verified in one place, treat
every other place it's used as unverified until checked.

## 3. The silence pass (fail loud, not quiet)

Look specifically for logic that can produce a wrong or missing result
without surfacing that anything went wrong:

- A null/undefined check that silently skips rendering instead of showing
  something (even a visible "—" or an error) — trace *why* it's null; if the
  surrounding logic is fully built but the markup was never added, that's a
  missing feature wearing a "safe" null-check as camouflage.
- A caught exception that logs somewhere nobody reads, or swallows the error
  and returns a plausible-looking default.
- A background job or async task with no path for the user (or the owner) to
  learn it failed.

The test: if this breaks, does the system announce it, or does it depend on
someone happening to notice? If the latter, that dependency is the bug.

## 4. The companion-piece pass

For any single feature, check for the pieces a user would assume come with
it, the way a TV assumes a remote:
- Undo / cancel / an exit from whatever this just started.
- Confirmation before anything destructive.
- Help text or a label where the action isn't self-evident.
- A permission/error path if the action can fail (network, auth, validation).

## 5. Before flagging anything: the Chesterton's Fence gate

Two checks, in order, before treating a gap as real:
1. **Search for the sibling.** Is there already a pattern doing this
   elsewhere in the app (a similar tooltip, a similar empty state, a similar
   validation)? If so, the "gap" may just be an inconsistency with that
   sibling, not an absence — fix it by matching the sibling, don't invent a
   new pattern.
2. **Check it's not deliberate.** Was this left out on purpose (a documented
   tradeoff, a deferred decision, a later phase)? If it's genuinely
   undecided, say so rather than silently filling it in.

Only once both checks pass does something become a real, reportable gap.

## 6. Fix-priority ladder (apply after a gap is confirmed)

In order of preference, strongest first:
1. **Eliminate** — redesign so the gap can't occur at all (e.g. one shared
   component that always renders with a guaranteed-readable background,
   instead of a component that can be placed somewhere unsafe).
2. **Prevent** — make the wrong state structurally impossible.
3. **Replace** — swap in a more reliable underlying mechanism.
4. **Facilitate** — make the correct way easier than the incorrect way.
5. **Detect** — catch it automatically before it ships (see
   `ci-integration.md`).
6. **Mitigate** — patch the one instance found; last resort, since it will
   likely recur elsewhere.

## Reporting

Keep "confirmed, fixed" separate from "flagged, not yet fixed" separate from
"checked, found clean" — don't blend a gap report with a bug report. State
plainly when a first-pass check turned out to be a false positive after
re-verification (builds trust that the rest of the findings are real).
