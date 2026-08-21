# LIVE-TESTING-BUG-AND-UX-DIRECTIVES.md
**Source:** Direct live testing of the deployed app by the project owner (screenshots +
verbal walkthrough). Every item below was actually observed happening, not theorized.
**Instruction to whoever executes this:** work through every item below. For each one,
verify the described current behavior still matches the live code before changing
anything (do not assume it's still exactly as described — re-check first). Do not skip
any item as "cosmetic" — the owner explicitly asked for all of these, no exceptions.

---

## BUG-1 — Repeated 409 errors on `/api/cloud/projects/1`
**Observed:** Console shows the same `Failed to load resource: 409` error firing
repeatedly (10+ times in a row) against `/api/cloud/projects/1`.
**Required:** Identify why this endpoint is being hit repeatedly with a conflict status —
likely an auto-retry loop hitting a real conflict without backing off, or a save
operation firing on every keystroke/render instead of being debounced. A 409 firing once
is a real conflict to handle; firing 10+ times in a burst is itself a bug (missing
debounce/backoff or an incorrect retry loop). Fix the root cause, not just silence the
console error.

## BUG-2 — Google Sign-In popup blocked
**Observed:** Console shows `[GSI_LOGGER]: Failed to open popup window... Maybe blocked
by the browser?`
**Required:** Popup-based OAuth is fragile across browsers/extensions (ad blockers,
popup blockers, some mobile browsers block popups by default). Either switch to a
redirect-based OAuth flow, or — at minimum — detect the popup-blocked case and show the
user a clear, actionable message ("Your browser blocked the sign-in popup — allow popups
for this site, or [redirect link]") instead of a silent console error with no user-facing
feedback.

## BUG-3 — AI Assistant shows contradictory connection status
**Observed:** The AI Assistant panel header shows a green "API · connected" pill at the
top, while the chat body simultaneously says "Disconnected" and "No AI key connected —
open the AI window, pick Cloud, and Connect your key." These two states directly
contradict each other on the same screen at the same time.
**Required:** These two indicators must never disagree. Trace both to their actual data
source and make them read from the same single source of truth for connection state.
This is misleading to a user trying to diagnose why chat isn't working — fix this before
anything else in this file, since it actively lies about system state.

## BUG-4 — "No cloud snapshot yet" is confusing / cloud save doesn't match expectation
**Observed:** A project shows "This project has no cloud snapshot yet — open it once
from its Cloud section (Save to Cloud) and it will appear here," even though the user
expected that saving/publishing a project already uploads everything.
**Required:** Either (a) make cloud snapshot creation automatic as part of the normal
save flow, so a user never has to perform a separate manual "open + Save to Cloud" step
to get their first snapshot, or (b) if a manual first-snapshot step is genuinely
necessary for a real technical reason, make that requirement clearly visible at the
point of upload/publish — not discovered later as a confusing message on a different
screen. State clearly which of these two directions is being taken and why.

## BUG-5 — "Download & Publish" behavior doesn't match its label
**Observed:** Clicking "Download & Publish" only downloaded a local JS file — nothing
appeared to actually publish/upload anywhere. The user expected this button to push the
project directly into cloud storage tied to their signed-in Google account, generating a
shareable access code, without a separate manual upload step.
**Required:** Clarify and fix the actual behavior of this button to match its name:
either it triggers a real cloud publish (uploads to cloud storage under the signed-in
identity, generates an access code, confirms success visibly) — or, if a genuinely
separate manual upload step is still required after download, rename the button and add
explicit on-screen instructions for the next step so it's not a dead end.

## BUG-6 — Google connect not accessible/discoverable from inside an open project
**Observed:** Connecting a Google account for sync only surfaces in Settings → Controls
→ Sync Identity, disconnected from the actual point where a user tries to use
cloud/upload features inside a project.
**Required:** When a user attempts any cloud-dependent action (upload, publish, cloud
save) while not signed in, route them directly to the Google connect flow at that exact
moment — don't leave them to separately discover Settings → Controls on their own. A
clear "Connected as [name]" / "Not connected — Connect Google" status row should be
visible at the point where cloud actions are attempted, not buried only in a settings tab.

## BUG-7 — No "Back to Dashboard" navigation from inside a project
**Observed:** Once inside an open project, there is no button to return to the
dashboard/projects list — the user has to use the browser's back button.
**Required:** Add a persistent, visible "Back to Dashboard" (or equivalent) navigation
element inside the project view, so returning to the project list never depends on
browser history.

## BUG-8 — Unexplained visual gap above the section nav
**Observed:** Below the "My Manager — Hybrid View" header line and above the
Overview/Planning/Execution nav pills, there is a large empty gap with nothing in it —
looks unfinished/unprofessional.
**Required:** Either fill this space with something purposeful (e.g. a short tagline
like "My Manager — Construction Project Management", a breadcrumb, or contextual project
info) or remove the gap entirely by tightening the layout. Do not leave visible dead
space with no content or purpose.

## BUG-9 — Overall navigation/UI clutter — hamburger menu requested
**Observed:** The current top navigation (methodology toggle + full section nav row) was
described as "extremely cluttered." The owner specifically referenced wanting a
hamburger-style menu that opens from the left (or top, matching this chat interface's
own sidebar pattern) instead of the current always-visible horizontal nav sprawl.
**Required:** Redesign primary navigation to use a collapsible hamburger/sidebar pattern
rather than a permanently-expanded horizontal button row, especially given how many
sections exist once Advanced Packs are enabled (Overview, Planning, Execution,
Governance, Closeout, DMAIC each with multiple sub-items). This is a real information-
architecture change, not a small style tweak — treat it as its own scoped redesign, and
confirm the specific interaction pattern (does it overlay, push content, pin open on
desktop but collapse on mobile, etc.) before implementing, rather than guessing the exact
behavior.

---

## Priority note for whoever executes this
BUG-3 (contradictory AI connection status) should be fixed first — it's actively
misleading about system state, which is worse than a missing feature. BUG-1 and BUG-2
are the two real functional/console errors and should be next. BUG-9 (navigation
redesign) is the largest-scoped item and should be treated as its own deliberate design
pass, not squeezed in alongside the smaller fixes — confirm the intended interaction
pattern before building it.

Work through every item, verify current state first, and report back what was actually
found and changed for each — do not mark anything done without confirming the described
behavior was reproduced and then fixed.
