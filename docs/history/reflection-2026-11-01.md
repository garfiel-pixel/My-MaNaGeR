# My MaNaGeR - session reflection archive, 2026-11-01 (second session)

Moved here from `reflection.txt` at the close of the 2026-11-02 session.

SESSION 2026-11-01 (second) - FINISH THE STYLESHEET SPLIT, COMMIT THE IN-FLIGHT
SESSION FIX, AND MAKE THE PLAN DESCRIBE THE TREE AGAIN

CONTEXT
The session opened on "see where we are in the execution plans". The plan said
"Position: Wave 1, 1.6 (the CSS split) is next" and marked every Wave 5 row
Queued. The tree disagreed: eight commits after the wave-5 capture (85a6cc8,
018c706, c59cdf9, ad0b712, 02bfd49 plus three small ones) had shipped B3, B4,
B5, B10, B7, A5, half of A1, half of B9 and the calculator chrome strip, and
four files sat uncommitted (the B1 session fix). The plan was stale by a day
and one wave, which is exactly the drift AGENTS.md lesson 14 warns about.

1. CSS SPLIT (1.6) - FINISHED
The split had nine carved layers and a 136 KB `css/src/99-remainder.css`.
`build.js` concatenates `css/src/*.css` in filename order (build.js:310-330),
so the only safe carve is a contiguous slice. I cut the remainder at its own
top-level section boundaries into fifteen named layers:

  82-launcher (1..2212), 83-floating-calculator (2213..2725), 84-themes
  (2726..2853), 85-performance-mode (2854..2914), 86-assistant-mailbox
  (2915..3019), 87-signin-polish (3020..3038), 88-dark-buttons (3039..3313),
  89-code-names (3314..3464), 90-calc-owner-wave (3465..4688), 91-design-system
  (4689..4750), 92-procurement (4751..4932), 93-wide-and-export (4933..5049),
  94-procurement-extra (5050..5192), 95-gold-buttons (5193..5253),
  96-accent-modes (5254..5294)

Proof of safety, in order of strength: the esbuild output is byte-identical
(`dist/mmgr.min.eb522108.css`, the file every page links); `css/mmgr.css`
differs only by the fourteen seam blank lines Prettier strips at end of file;
`verify-css-integrity` ARM 0 (assembly), ARM 1 (comment closers) and ARM 2
(all 1,487 class rules survive into dist) pass; `verify-sizes` passes; `npm run
verify` exits 0. `css/src/README.md` (layer map at :25) documents the rules, and
`docs/DEVELOPER-GUIDE.md` now points at it. No `tables` or `print` layer exists
on purpose: those rules live inside the surfaces they style.

2. B1 SESSION FIX - COMMITTED, AND ITS FIRST DRAFT HAD A REAL DEFECT
The uncommitted work added `Entitlements.ensureSession()`
(js/app/entitlements.js:82), a boot-time `restoreSession()` in
js/mmgr-app.js:750, and a "Checking your sign-in" branch in the assistant
(js/mmgr-ai.js:207-246). Its gate, `qa-ai-win`, hung twice at its own watchdog
(240s, then 600s), which was not a slow test: `open()` called itself again
whenever `ensureSession()` resolved true, so a valid session behind a gate that
still refused re-entered the same branch forever and froze the tab. Fixed at
js/mmgr-ai.js:229: re-enter only when `aiAssistant()` can now pass, otherwise
fall through to the refusal. A third arm pins that rule.

The harness needed the same correction: it stubbed `aiAssistant()` closed while
opening the session, a state the app cannot reach. The stub now mirrors the real
relationship (`aiAssistant()` follows `isSignedIn()`), and the watchdog is 300s
and env-overridable (`MMGR_QA_WATCHDOG_MS`, tools/qa-ai-win.cjs:59-68) because
the gate grew polling arms.

3. PLAN RECONCILIATION
`EXECUTION-PLAN.md`: the position line, the 1.6 row, the wave-1 heading, the
whole wave-5 table (5.3, 5.4, 5.6, 5.8 now say which half shipped and name the
gate), a progress-log entry and a new Next line. `CONTINUATION-DIRECTIVE.md`:
one status-log entry, the E row's stale 31.7 / 28.9 coverage figures corrected
to the measured 11.8 / 9.7, and the 1.4-1.6 row closed.

DRIFT FLAGGED, NOT FIXED
B9 (`02bfd49`) binds ArrowLeft/ArrowRight globally and wraps at the ends.
`AUDIT-DIRECTIVE-2026-11-01.md` says mouse side buttons only, "never the
keyboard arrows", and stop at the ends; it also asks for five pins, an
off-by-default toggle and a reset, none of which exist. Recorded in the 5.8 row
as needing an owner ruling before the item can close.

VERIFICATION (all run in this session)
  node build.js / --css                green, 24 layers, dist hash eb522108
  node tools/verify-css-integrity.cjs  PASS (ARM 0, 1, 2)
  node tools/verify-sizes.cjs          PASS (152 files)
  node tools/qa-ai-win.cjs             PASS 27/27, exit 0
  teeth (js changes stashed, rebuilt)  FAIL 2/27, reproducing the owner report
  npm run verify                       exit 0, fail 0, 160 harnesses registered
  node tools/verify-doc-size.cjs       PASS

COMMITS
  42500e7 refactor(css): carve the remaining tail into named layers
  a183fee fix(ai): read the session before refusing sign-in (shell v531, which
          also backfills the missing v526 to v530 changelog entries)
  b6c1686 docs(plan): reconcile wave 1 and wave 5 with the shipped tree
  ab8dc80 docs(reflection): record the CSS split close and the session fix
  8e5d85c test(qa): re-baseline three gates against the shipped behaviour
  f0c5ec7 test(qa): wait for the rail nudge to finish, not for its flag

4. CI REPAIR LOOP (pushed, then polled)
The nine commits went to origin/main (ee64a2e..ab8dc80). CI run 41380641177
came back RED on three browser gates. Each was the HARNESS reading a state the
app no longer has, not the app being wrong, and each fix keeps its teeth:

- qa-full 68b (signed-out AI click) read ONE synchronous tick. The click now
  answers "Checking your sign-in" first and refuses only once the Worker has
  answered (ensureSession, <=2.5s), so the gate saw the interim copy. It now
  polls to the FINAL answer (<=4s), still fails a dead click or an opened
  window, and ignores "checking" so the interim state alone cannot pass it.
- qa-appshell APP-1 measured INSIDE the owner's first-run rail nudge (pops out
  at +0.9s, holds 1.5s, closes at +2.4s, once per device). CI read the nudge as
  "the rail is open" at 1280/1024/900. The first fix waited on the nudge's
  once-per-device FLAG - which app.html writes when it schedules the nudge, so
  it is already set before the rail moves - and CI failed the same three
  viewports again (run 41382632796). The gate now watches the rail-nudge CLASS:
  appear, then go away, 6s cap. A probe on a fresh profile at 1280 shows the
  nudge running from about 0 to 1.3s after load, which is why the old
  click-to-close masked it on this machine and never could on CI.
- qa-team-ui G9/G11 met the Worker's general bucket (30 a minute) keyed by the
  CODE header - cloudRateKey prefers X-Owner-Code/X-Editor-Code over the
  address, so the harness's per-request CF-Connecting-IP rotation cannot give
  these calls their own allowance - and CI saw 429 on every call. Both arms now
  retry until the sliding window opens (6 attempts, 8s apart), which is what
  the app's own 60s poll does. No limit was weakened.

Local proof before pushing 8e5d85c: qa-full 194/194, qa-appshell 79/79,
qa-team-ui 23/23 (and again after Prettier reflowed the file).

KNOWN RED, EXTENDED ONLY: tools/verify-contrast.cjs fails "gold on card 2.10:1
(min 3:1)" in css/marketing.css. --gold (#d4af37) is the BULLION FILL; gold as
words is --gold-text-on-light (#7a5a0b, 6.37:1). The pair predates the
2026-10-30 gold identity (--gold was #d96b27, an orange) and measures a fill
token against the text/UI floor. It is not in ci.yml and does not gate a
deploy. Two honest fixes, both owner calls: point the pair at --gold-text, or
darken the fill (a brand change).

STILL OPEN
Wave 5: 5.1 (cloud identity), 5.2 (orphaned subscriptions), 5.5 (admin
ergonomics), 5.7 (photos), 5.9 (craft), B2 (collab controls always present),
A1's empty-panel half, A2, B7's one-shot demo, B8, B9's remaining scope (B9
needs the owner's ruling on arrow keys versus mouse side buttons).
Not deployed in this session.
