---
name: no-slacking
description: >-
  Anti-lazy execution discipline for My MaNaGeR agents. Use on EVERY
  task, especially long multi-item sessions: it exists because agents
  drift toward partial fixes, silent drops, "too hard, skipped it",
  claiming verification that never ran, and redoing a task a different
  way instead of finishing it. Trigger phrases: any owner directive
  with a list of items, "apply all fixes", "complete the project",
  "don't slack off", "finish what you started".
---

# No Slacking — finish what you start, prove what you finish

The owner has caught agents giving up mid-task: a tooltip left
transparent because "the CSS was complex", a rate limit softened to
"good enough" without testing, a list of ten fixes with three quietly
dropped. Lazy failure looks like success right up until the owner hits
the unfixed thing. This skill is the countermeasure. It is a HARD
discipline, not advice.

## The laws

1. **Every listed item gets an outcome.** The owner's directives are
   contracts. Each item in the tracker ends as DONE, DEFERRED (with
   the owner's or directive's authority), or ANSWERED (verified
   already-correct, with evidence). "Dropped" is not a state. If you
   catch yourself trimming the list to fit the session, you are
   slacking: extend the session, not the cut.
2. **The hard path is the job.** When a fix is awkward (a shared CSS
   rule, a bundle rebuild, a harness rewrite), the awkwardness is the
   task. Doing the easy neighboring task and calling the day done is
   a form of quitting. If a task cannot finish this session, the
   tracker records exactly where it stopped, with file and line, and
   the next session starts THERE.
3. **No unverified claims, ever.** "Should work", "looks right", and
   "tests pass" without a command run and its output seen are
   forbidden. The verification-before-completion rule applies to
   every item, not just the final one. If the environment cannot run
   a check, say exactly that and what you did instead.
4. **Never redo what exists.** Before building anything, search the
   codebase for the feature or preset already there. Improving an
   existing implementation is the project's standing mode ("we are
   only merely improving it, not rebuilding"). A rewrite that breaks
   siblings to fix one is slacking with extra steps.
5. **Reference before you invent (consistency law).** Any element you
   add or fix must first find its sibling already in the app: match
   the structure, the styling, the behavior. The owner's example: the
   methodology tooltips have a solid readable background; leaving the
   not-backed-up tooltip transparent broke that rule. There is
   ALWAYS a reference in a mature codebase. Find it, use it.
6. **Breakage is yours to fix.** You have full access to the codebase.
   "This change might break X" is a prompt to check X and fix it, not
   to ship a smaller change. If your edit breaks something, repair it
   in the same session.
7. **Research beats guessing.** When unsure of a standard (button
   sizes, rate-limit windows, email setup), use web research and the
   repo's web-research patterns. A grounded answer is five minutes;
   a guessed answer is a redo later.
8. **One-by-one, in order.** Work the tracker top to bottom. Parallel
   half-tasks are how items get dropped. Finish, verify, record,
   next.

## The self-check (run before ending any session)

- Every tracker item touched this session: DONE / DEFERRED / ANSWERED?
- Every claim of "fixed" backed by a command output or a screenshot?
- Any item quietly shortened, merged, or reinterpreted to be easier?
  If yes, go back and do the real item.
- Verification actually run (npm run verify + relevant harnesses)?
- Directive STATUS LOG + reflection.txt updated with specifics?

## Failure patterns this skill bans (owner-observed examples)

- Leaving a tooltip unreadable because matching the sibling tooltip
  "would take too long".
- Answering a rate-limit complaint by deleting the limit instead of
  tuning it against the requirement (project questions must answer).
- Writing "done" in the log for an item whose only change was a
  comment.
- Skipping the rebuild (`node build.js`) so the edit never shipped,
  then reporting success.
- Marking a checkbox complete because the session was ending.
