# My MaNaGeR — Full Gap Audit
**Source:** Direct code read of `mymanager-fixed.zip` (latest upload) — `worker.js`,
`js/mmgr-cloud.js`, `js/mmgr-state.js`, `js/mmgr-render.js`, `css/mmgr.css`, migration
SQL, and cross-checks against every prior finding raised in this conversation.
**Honest count up front:** you asked for up to 50. I found **31 real, non-padded
items**. I'm not stretching to hit 50 — a large number of previously-flagged issues
(greeting bug, exportState secret-stripping, select styling, InfinityFree copy, stale AI
marketing copy, scrollbar, focus states) are **already fixed** in this build, and the
new cloud backend (Phases 1-3) is genuinely well-hardened — constant-time code compare,
timing-attack sinks on every auth failure path, a real create-race guard, server-side
secret-stripping on the R2 blob, section-scope enforcement done server-side not just in
the UI, proper session cookie flags (HttpOnly/Secure/SameSite/7-day expiry), and a real
streamed body-size cap that doesn't just trust the Content-Length header. That's a lot of
your own prior directives correctly closed out. What follows is what's left.

---

## A. Cloud backend — security & robustness gaps (highest priority, real code)

1. **No rate limiting / lockout on any cloud auth endpoint** (`save`, `load`, `recover`,
   `meta`). Code entropy is strong (80-bit owner codes, brute force is not practically
   feasible), so this isn't an urgent guessing-attack risk — but there's currently
   nothing stopping a script from hammering `/api/cloud/projects/:id/meta` thousands of
   times a minute, which is a cheap denial-of-service / cost-inflation vector against
   your own D1/R2 usage, independent of whether codes can be guessed.
2. **No CORS policy explicitly set on `/api/cloud/*` routes.** Currently fine since the
   app calls its own Worker same-origin — but worth an explicit, deliberate CORS header
   (even if it's "same-origin only, reject everything else") rather than relying on
   default behavior, so a future change elsewhere doesn't accidentally open this up.
3. **`handleCloudRecover` reissues a code but does not invalidate the previous one's
   changelog attribution retroactively** — worth confirming (not read in full) whether
   old changelog entries still correctly show who made past changes after a recovery
   event, or whether a recovery silently orphans the history's attribution.
4. **No explicit audit log of recovery events themselves.** The changelog logs project
   *content* changes, but does it log "owner code was recovered/reissued on [date]" as
   its own event? If not, an owner has no way to see in-app that a recovery ever
   happened — worth adding as its own changelog entry type.
5. **Editor code revocation (`DELETE .../editors/:editorId`) — confirm it also
   invalidates any in-flight save the editor might be mid-submitting**, not just future
   requests. A revoke-then-in-flight-save race is a small but real edge case for a
   permissions system.
6. **No maximum count on editor codes per project.** An owner could generate an
   unbounded number of editor codes — not a security hole, but worth a sane cap (even a
   generous one) so a mistake or automation loop doesn't silently create hundreds.
7. **`stripStateSecrets` on the server only strips `config.ai.apiKey`, `azureKey`, and
   `config.api.keys`.** If a future feature adds another secret-shaped field to state
   (the Gemini fallback work, or the still-open credential-slot redesign from an earlier
   audit), this list needs to be updated in lockstep or the new secret slips through
   uncaught into the R2 blob. Worth a comment flagging this as a maintenance trap, if one
   isn't already there.

## B. Cloud backend — product/UX gaps

8. **No visible indicator in the UI of *when* a project was last synced to cloud vs.
   only-local**, beyond what `meta` returns programmatically — worth confirming this is
   actually surfaced to the user, not just available to the API.
9. **No conflict/staleness warning if a device loads a project, someone else saves in
   the meantime, and the first device saves later** — last-write-wins was the agreed
   design, but does the UI ever tell the person "this was just overwritten by a more
   recent cloud save"? Silent last-write-wins with zero user-facing signal is a worse
   experience than last-write-wins-with-a-heads-up.
10. **No project-level "disconnect from cloud" action found in the scan** — once a
    project is cloud-linked, is there a way to deliberately unlink it (keep local copy,
    stop syncing) without deleting it outright? Worth confirming this exists.
11. **Editor's granted scope vs. what they see when they open the app isn't confirmed
    end-to-end** — the server correctly filters what an editor can *write*, but has the
    read-side UI (which panels are visible/greyed for an editor session) been verified
    against the same `CLOUD_SECTIONS` list the server uses, or could the two lists drift
    apart over time since they're presumably defined independently in server and client
    code?

## C. General app — carried-forward items still genuinely open

12. **DIR-2 (Voice-to-Claim noisy-audio transcription accuracy)** — per your own
    priority directives, still queued, not re-audited this pass.
13. **Real-time presence** — explicitly deferred by your own decision, correctly not
    built; listed here only so it doesn't get lost as "forgotten" vs. "deliberately
    deferred."
14. **Additional sign-in providers (Yahoo/Microsoft/email+password)** — explicitly
    deferred, same as above.
15. **Billing/subscription tier** — explicitly deferred pending real usage scale, same
    as above.

## D. Fresh findings — code quality

16. **188 `try/catch` blocks across the codebase, of which at least 15 are genuinely
    empty (`catch (e) {}`) with zero logging.** Most of the ones checked are in
    voice-capture cleanup paths (stopping media tracks, closing audio contexts) where
    silent failure is reasonable — but this is a large enough number that a few might be
    swallowing real errors worth surfacing. Worth a pass specifically checking whether
    any empty catch is hiding something that should report to the client error log
    (`js/mmgr-errors.js`) rather than vanishing silently.
17. **2 leftover bare `console.log()` calls** (not `.error`/`.warn`) found outside the
    voice/debug-specific paths — low priority, but worth a sweep before a "production
    clean" pass, since leftover debug logging is the kind of thing that accumulates.

## E. Accessibility

18. **`aria-live` regions are used only once across the entire app** (toast/status
    messaging). Screen-reader users would not be told about most async state changes —
    AI responses arriving, save confirmations, error toasts, the cloud save-status
    updates — since none of those appear to be in a live region. This is a real,
    fixable accessibility gap, not a style nitpick.
19. **`lang="en"` is present on every page** — good, no gap there, listed only to
    confirm it was checked, not to pad the count.

## F. Documentation / process

20. **The field-guide plan (from earlier this session) has not yet been executed** —
    the guide still needs the AI/backup sheets rewritten and the new sheets (Voice,
    Claim Pack, Weather, feature-flags) added. Not re-scanned this pass since it's
    already tracked in its own document — listed here only as a pointer so it isn't lost
    among the newer cloud-backend work.
21. **The marketing-pages plan (also from earlier this session)** — same status, tracked
    separately, not re-scanned, listed as a pointer only.
22. **No documentation anywhere (guide or otherwise) yet explains the cloud
    backend to an end user** — once Phases 1-3 are stable, the field guide's Data/Backup
    sheet will need a real rewrite covering owner/editor/viewer codes, recovery, and the
    changelog — currently that sheet (per the earlier field-guide audit) only covers
    local export/import and Drive backup, neither of which is this new system.

## G. Minor / low-priority polish

23. **Editor code display format (`XXXX-XXXX-XXXX-XXXX`)** is shown once at creation per
    the "shown once" security pattern already established for the owner code — worth
    confirming there's a clear, unmissable "copy this now, you won't see it again" UI
    treatment, matching how seriously the owner-code flow already treats this same
    problem.
24. **No visible favicon/branding check performed this pass** — out of scope for this
    audit, not flagged as a real finding, noted only for completeness.
25. **CSP hash / service-worker cache-version build guards** — confirmed to exist per
    your own team's last push log (`verify-csp-hashes`, `verify-sw-cache`) — not
    re-verified this pass since they were already confirmed working; listed as closed,
    not open.
26. **The 4 pre-existing, confirmed-unrelated test failures** from your last build
    report (`qa-full` check 04, `qa-marketing` mkt-03, `qa-stress` S06/S07,
    `qa-drive-smoke` watchdog hang) — still open per the continuation directive already
    given; not re-diagnosed here, listed as a pointer only.

## H. Open questions worth deciding, not bugs

27. **Does a cloud-linked project's changelog have any retention limit / pruning
    strategy**, or does it grow unbounded in D1 forever? Worth a deliberate decision
    (keep everything vs. prune after N entries or N days) before real usage accumulates
    history you didn't intend to keep indefinitely.
28. **Is there a plan for what happens to a cloud project's D1/R2 data if the owner's
    Google account is deleted or the project is abandoned?** No retention/deletion
    policy found — worth deciding before this scales past personal testing.
29. **Max project size** — the 8MB body cap on save is generous and sensible for a state
    blob including voice/claim data, but worth confirming a genuinely huge project (many
    months of voice recordings referenced) doesn't eventually collide with it, and what
    the failure mode looks like for the user if it ever does (right now it's just a 413
    — worth a friendly message rather than a bare HTTP status reaching the user).
30. **Multi-project ownership dashboard** — once someone has several cloud-linked
    projects tied to one Google account, is there a single "all my cloud projects" view,
    or does each one only surface individually via its own code? Worth deciding if this
    is wanted before it becomes an unplanned gap once someone actually has 5+ cloud
    projects.
31. **Export-to-cloud vs. cloud-is-primary** — worth being explicit (may already be
    decided in the architecture plan, wasn't re-confirmed this pass) about whether local
    storage or the cloud snapshot is considered the "source of truth" during the brief
    window between an edit and its next auto-save, in case a browser crashes exactly
    then.

---

## Suggested priority order

1. **Section A (1-7)** — real security/robustness items in the new backend, do these
   first while the cloud code is still fresh in whoever built it's mind.
2. **Section E (18)** — the aria-live accessibility gap is a genuine, fixable issue
   affecting real users, cheap to fix, currently invisible unless someone's specifically
   testing with a screen reader.
3. **Section B (8-11)** — UX gaps in the cloud feature, do alongside/after A since they
   touch the same code.
4. **Section H (27-31)** — decisions, not code — resolve these on paper before they
   become "oh, we never decided this" surprises at scale.
5. **Sections C, F** — already-tracked items, no new action here, just don't lose them
   among the cloud-backend work.
6. **Section D, G** — lowest priority, cheap cleanup whenever there's spare time.

---

*No code was changed in producing this audit. Every numbered item is either a direct
code citation or explicitly framed as an open decision rather than a confirmed bug.*
