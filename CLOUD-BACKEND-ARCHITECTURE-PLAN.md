# My MaNaGeR — Cloud Backend Architecture Plan
**Status:** Decisions settled through conversation with Garfield. This is a plan and
technical shape document for a genuinely new capability — there is currently NO backend
storage in the app (`worker.js`/`wrangler.jsonc` confirmed: the Worker today only
injects security headers and relays Google OAuth; no D1/KV/R2 binding exists). Nothing
below has been built. This document exists so the build has a clear, agreed shape before
anyone writes code.

---

## 1. Core principle — unchanged from the app's original architecture

Cloud is **opt-in per project**, never mandatory. A project with no cloud connection
works exactly as it does today — fully offline, fully local, zero backend dependency.
This plan adds a NEW capability on top of the existing app; it does not change how a
local-only project behaves. This is the same "gate the backup, not the app" principle
already established for Google Drive backup, extended to a real backend.

---

## 2. Storage shape

- **Cloudflare D1** (SQL) — structured records: one row per project (project id, hashed
  owner code, hashed editor code(s) + their scope, hashed viewer code, owner's linked
  Google account id if signed in, created/last-updated timestamps), plus a changelog
  table (see Section 5).
- **Cloudflare R2** (object storage) — the actual project state JSON blob per save, and
  later, any audio/Claim Pack files if those are ever pushed to cloud. D1 rows should
  reference an R2 object key, not embed the full blob — keeps D1 rows small and fast to
  query.
- **Google sign-in stays as the only cloud-identity method for now.** Yahoo, Microsoft,
  or a rolled-your-own email+password system are explicitly deferred, not rejected —
  Google alone is real leverage (they handle password storage, verification, reset —
  none of that has to be built) and is sufficient to ship the core feature.

---

## 2A. Google sign-in — corrected shape (SINGLE unified flow, app-wide)

**This section supersedes the earlier back-and-forth in this conversation about
splitting Google sign-in into two separate consent flows. That was wrong. Garfield's
correction stands: ONE Google button, ONE consent screen, flowing through the entire
app.**

### What was wrong with the two-flow idea
Google natively supports requesting multiple scopes in a single consent screen —
`openid email profile` (identity) plus `drive.file` (optional Drive backup) can be
requested together in one click. There is no need for two separate sign-in flows or two
separate buttons. One sign-in, one grant, covers both purposes.

### The real problem — confirmed by direct code inspection
`js/mmgr-google-auth.js` currently wires Google sign-in as a feature scoped to exactly
one place: the backup/restore controls inside admin settings. It requests `drive.file`
scope only (line 207: `const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'`)
and there is no shared, app-wide "am I signed in?" layer anywhere else. This is a
multi-page static site (`index.html`, `admin.html`, `project.html`, etc., each a
separate page load, not a single-page app) — so a sign-in on one page has no way of
being known by any other page unless something explicitly checks and restores it.

### Required change
1. **Combine scopes into one request**: `openid email profile https://www.googleapis.com/auth/drive.file`,
   requested together in the single "Sign in with Google" button, wherever that button
   lives. One consent screen, both purposes granted at once.
2. **Extract the stable Google account ID (the `sub` claim from the identity token) —
   not the email address** — as the key used to link a person to their backend records.
   Email can change or be reused; `sub` does not.
3. **Build one shared, small auth-session script, included on every page** — not just
   admin.html. On load, it silently checks for an existing valid Google session and
   restores the signed-in UI state (e.g. "Signed in as [name]") without requiring the
   person to click anything again.
4. **Handle token persistence carefully**: do not store the raw access token indefinitely
   in localStorage (Google access tokens expire roughly hourly). Persist a lightweight
   "signed in as this identity" marker instead, and use Google's own silent
   re-authentication flow to refresh the underlying token when needed.
5. **Every page gets the same shared script** — the public project pages, the admin
   page, the settings drawer — so the signed-in state looks and behaves identically
   everywhere, not just wherever the feature happened to be built first.
6. **What each part of the single grant is used for stays cleanly separated in the
   BACKEND logic even though the FRONTEND is one button**: the `sub`/identity portion
   feeds the new cloud-backend project save/recovery system (Section 3 onward); the
   `drive.file` portion continues to power the existing Drive backup/restore feature,
   completely unchanged in what it does. One click grants both; what happens with each
   piece of that grant stays logically distinct in the code.

---

## 3. Three-tier code model

| Code | Who gets it | What it does |
|---|---|---|
| **Owner/recovery code** | The project creator | Full access. If lost, admin can look up the hashed record after a verification process and reissue it. Tied to the cloud record. |
| **Editor code** | Anyone the owner shares it with | Scoped at creation time — the owner toggles which sections/panels (WBS, Budget, Risk, RACI, etc.) this code is allowed to touch. Generates a code bound to that scope. |
| **Viewer code** | Same as today | Unchanged — read-only, exists already, no new work needed here. |

### Scope enforcement — must be real, not cosmetic
Greying out sections in the UI for an editor code is not enough on its own. The backend
itself must reject any write from an editor code that falls outside its granted scope —
otherwise a compromised or shared-further editor code could bypass the UI restriction by
hitting the backend directly. Scope needs to be checked server-side, at write time, every
time — not just client-side at render time.

---

## 4. Conflict handling — simplified per Garfield's scoping decision

- **No real-time presence/live-cursor system** — explicitly deferred. This would have
  needed Cloudflare Durable Objects (a live connection per project tracking who's
  currently editing what) and was the single largest infrastructure item in the original
  version of this plan. Dropped in favor of the changelog approach below, which is
  simpler to build and arguably more useful in practice (a log you can act on, vs. a
  live indicator you can only watch).
- **Editor code scoping reduces most real conflicts by construction** — two editor codes
  scoped to different sections simply can't collide.
- **Underneath that, keep a simple last-write-wins fallback** for the cases where scopes
  do overlap (e.g. the owner and an editor both touch the same section). This is
  intentionally NOT the field-level CRDT-style merge engine already designed for local
  multi-device sync — that level of complexity isn't needed here since true simultaneous
  same-field editing is now rare by construction (scoping) rather than the common case.

---

## 5. Changelog — the core review/trust mechanism, replacing live presence

### Required shape, per Garfield's explicit ask for revert power
A changelog that only stores human-readable descriptions ("Risk Matrix updated") cannot
actually revert anything. To support real revert, the changelog must store one of:

- **(A) Field-level before/after values** for every changed field, per save event, or
- **(B) Periodic full-state snapshots** (e.g. one R2 snapshot per save, or per N saves)
  that a revert can roll the whole project back to.

**Recommendation: (A) for anything reasonably small (most form fields, WBS edits, RACI
changes), falling back to (B) for anything where field-level diffing is impractical
(e.g. a full re-import, a bulk paste, a whisper-transcribed Claim Pack generation).**
This mirrors how git handles small diffs vs. large binary-ish changes, and keeps the
common case (someone edited a few fields) cheap while still allowing a full-project
rollback for larger operations.

### Every changelog entry must record:
- **Timestamp** (when).
- **What changed** — the actual field(s) and their before/after values (per the
  revert requirement above), not just a description.
- **Who made the change** — the owner's account name/label if signed in, or the
  human-readable label the owner gave that specific editor code at creation time (e.g.
  "Site Super — Riverside" as the editor-code label, not a full login identity — matches
  Garfield's own point that the owner already knows who they handed each code to, so the
  editor code itself doesn't need its own account/login).

### Owner revert power
- The owner (and only the owner — editor codes should not have revert authority over
  changes outside, or even inside, their own scope, since revert is an ownership-level
  trust action, not an editing action) can select a changelog entry and revert it.
- A revert should itself generate a new changelog entry ("Owner reverted [change] made
  by [editor label] at [time]") rather than silently erasing the history of what
  happened — the paper trail should show the revert happened, not just make it look like
  the bad edit never occurred.

---

## 6. Cost and billing

- Cloudflare D1/R2 usage is genuinely free up to a real usage threshold, and this project
  is currently well inside "testing/early usage" territory — no billing/subscription
  work needed yet, correctly deferred per Garfield's own call.
- **Flag for later, not now:** once cloud-connected projects and their storage volume
  grow past free-tier limits, a subscription model becomes necessary to cover real
  Cloudflare costs. This should be revisited as a distinct, later planning item — not
  designed now, just kept on the radar so nobody is surprised by a bill.

---

## 7. What stays exactly as it is today (no change)

- Local-only projects: fully offline, fully functional, zero backend calls, exactly as
  now.
- Viewer codes: unchanged.
- The existing Google Drive backup/restore feature: **DECIDED — coexists, does not get
  superseded.** "Sign in with Google" (Section 2A) links identity to the new backend for
  auto-save/recovery. "Drive backup/restore" stays a separate, optional action for
  pushing an actual portable file copy into the person's own Drive (for manual sharing
  or an independent backup outside this app's own database). Both are powered by the
  same single sign-in grant (Section 2A) but remain logically distinct features.

## 7A. Privacy policy — decided, minimal scope

A privacy policy page, linked from the front page, is sufficient. Garfield does not want
this over-engineered — plain, accurate disclosure of what's collected (Google account ID
for identity/backend linkage, project data for cloud-connected projects only) and a link
a visitor can read, nothing more elaborate. Not a blocking design item — can be written
once the backend's actual data handling is finalized, so the policy describes real
behavior rather than a guess.

---

## 8. Phasing (suggested, not yet confirmed with Garfield)

1. **D1 + R2 storage, owner code + recovery flow, Google-linked save/restore.** This is
   the minimum viable version of "my project lives in the cloud and I can get it back."
2. **Editor code generation with section-level scoping**, enforced server-side.
3. **Changelog with field-level diffs (or snapshot fallback) + owner revert.**
4. *(Explicitly deferred, not scheduled)* Real-time presence, additional sign-in
   providers (Yahoo/Microsoft/email+password), billing/subscription tier.

---

## 9. Open items requiring Garfield's decision before build starts

- [ ] Confirm phasing order above, or reorder if a different sequence matters more.
- [x] ~~Decide the relationship between this new cloud-backend and the existing Google
  Drive backup/restore feature~~ — **DECIDED, see Section 7: coexist, one sign-in grant
  powers both, features stay logically separate.**
- [ ] Confirm the field-level-diff-with-snapshot-fallback approach to the changelog
  (Section 5), since this is a real design commitment, not just a detail.
- [ ] Define what the admin "verification process" for code recovery actually requires
  from the user (e.g. matching the Google account on file, answering a security
  question, something else) — not specified yet, and this is a real security control
  that needs to be deliberate, not assumed.

---

## 10. Separate item, flagged this session — greeting personalization bug

**Not part of the cloud-backend work above — a small, unrelated UI bug caught and fixed
in scope while this document was being edited, included here since Garfield asked for it
in the same pass.**

### Finding — confirmed by direct code inspection, exact root cause
`js/mmgr-render.js`, `renderGreeting()` (lines 43-59), has a genuine self-overwrite bug:

1. Lines 44-51: sets `#greeting-text`'s content to `Welcome, {userName}` — the name IS
   being written correctly at this point.
2. Lines 52-58: **immediately after, in the same function call**, the code selects the
   PARENT element (`#greeting`) and overwrites its entire `innerHTML` with a brand new
   time-of-day span — `<icon> <span id="greeting-text">Good Morning</span>` (or
   Afternoon/Evening) — which completely replaces the DOM node that had the person's name
   in it moments earlier, with a fresh one that has no name at all.

This is why the name never appears: every single call to `renderGreeting()` writes the
name, then immediately destroys that write by rebuilding the parent with time-of-day-only
content. This is not intermittent — it happens every time, by construction.

### Required fix
Combine both pieces of information into ONE write instead of two sequential,
mutually-overwriting ones — e.g.:
```
const hour = new Date().getHours();
const timeLabel = hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening';
const icon = hour < 18 ? 'i-sun' : 'i-moon';
const nameSuffix = (s && s.userName) ? `, ${s.userName}` : '';
g.innerHTML = `<svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#${icon}"></use></svg> <span id="greeting-text">${timeLabel}${nameSuffix}</span>`;
```
(Illustrative — match existing code style/quoting conventions exactly when implementing,
this is not meant to be pasted verbatim.) The key requirement is architectural: there
must be exactly ONE write to the greeting element per render, not two sequential writes
where the second blindly clobbers the first.

### Verification before edit
Confirm `s.userName` is actually populated at the time `renderGreeting()` runs in the
real flow Garfield is testing (e.g. entering a name in settings) — the bug above is
real and will produce this symptom regardless, but worth confirming there isn't also a
SECOND issue (name never being saved to state in the first place) stacked underneath it.
If the name displays correctly immediately after this fix, the state-side flow was fine
all along and this was the only issue.

---

*This document is a plan only. No backend code, D1 schema, or R2 wiring has been
written. It exists to lock in the architecture decisions already made in conversation so
implementation has a clear, agreed target.*
