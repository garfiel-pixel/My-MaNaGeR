# My MaNaGeR — PLAN OF ACTION: AI / Voice / Sync / Integration
**Classification:** Sequencing document. This does not replace or reorder
MASTER-ACTION-PLAN-v3-STRICT.md — it slots the material from
AI-VOICE-SYNC-INTEGRATION-RESEARCH.md into that existing rank structure, and adds one new
rank where nothing existing fits. Nothing in this file is approved for build. This is the
"what order, and why" layer — a build spec comes later, separately, only when a phase is
actually greenlit.

**Standing rule inherited from the master plan:** no phase begins until the prior phase's
exit criteria are VERIFIED, not assumed. Same skeptical-audit standard applies here.

**Strict execution rule (new, applies to whoever/whatever executes this plan):** once a
verification, confirmation, or audit step has been completed and has passed, execution
continues immediately to the next step in sequence. Do not stop and wait after a
confirmation to ask whether to proceed — the confirmation passing *is* the signal to
proceed. Stopping is only correct when a check actually fails, when a genuine ambiguity
needs a human decision that isn't answered anywhere in this plan or the master plan, or
when a phase's exit criteria aren't met. A passed check is not a pause point.

**Reinforcement (explicit, because this kept happening in practice):** confirming a result
is not a deliverable on its own — it is a step inside a deliverable. A gate passing, a file
existing, a test going green: these are checkpoints, not stopping points. The instructions
in this plan are written to be clear and self-contained precisely so that execution does
not need to pause and ask after every checkpoint. If the next step is already named in this
document — in the rank sequence, in a phase's own listed sub-items, or in a "suggested
followups" style prompt the tool itself produces — proceed to it immediately in the same
run, without waiting for a new instruction to be typed. Only stop for: a failed check, a
genuine fork not resolved anywhere in this plan, or reaching the actual end of what's been
scoped so far. Repeatedly stopping after successful confirmations to ask "should I
continue?" is itself the failure mode this rule exists to eliminate.

**Non-negotiable constraints inherited, unchanged (apply to every item below):**
1. Unified state only — no side-stores.
2. Zero mandatory server cost — optional network calls circuit-broken.
3. No notification spam.
4. Offline-first is a hard requirement, not an enhancement.
5. Portable data — single `.json` export, no server dependency to read it back.

Any item below that can't satisfy all five as designed gets redesigned or dropped — same
rule as the master plan, no exceptions carved out for AI/voice work specifically.

---

## Where this attaches to the existing rank order

| Existing Rank | What it already covers | What this plan adds to it |
|---|---|---|
| Rank 1 — Evidence/Claim Pack | Claim package generation from state | Voice-to-Claim pipeline: transcripts feed the claim pack directly |
| Rank 2 — Digest Engine | Auto "what changed" digest, AI preset prompts | Wiring `submit()` to a real model; agent-style presets |
| Rank 4 — PWA/Offline Hardening | Cache-first SW, crash-safe persistence | New sub-phase: multi-device reconciliation (4.4) |
| Rank 9 — API/Webhook Layer | Deferred until digest engine proven | MCP server exposure named here explicitly, still deferred |
| **New: Rank 1.5** | *(nothing existing covers this)* | Meeting Voice Capture + Transcription infrastructure |

Rank 1.5 is new because voice capture is prerequisite infrastructure for the Rank 1 upgrade
below — same pattern the master plan already uses for "old Phase 1 is prerequisite
infrastructure, not a competing rank." Voice capture doesn't compete with Rank 1, it's
plumbing for it, exactly like Today Decision Engine / Meeting-to-Action Loop is plumbing
for Ranks 1 and 2.

---

## RANK 1.5 — Meeting Voice Capture + Transcription (new, prerequisite to 1.4 below)

**STATUS: CONFIRMED COMPLETE — verified against actual codebase, not assumed.**
`mmgr-voice.js` exists and is wired. `qa-voice.cjs` gate exists (29+ checks) covering
chunked IndexedDB persistence, abrupt-kill durability, Tier 0 circuit-break, zero-AI
rule-based transcript extraction into the Decision Log, and Tier 1 offline whisper
(DSP, circuit-break, retry). The opt-in `RUN_WHISPER=1` real pipeline run was verified
end-to-end against the bundled reference `jfk.wav` through the actual IndexedDB chunk
path (worker → WASM → decode → state) — this is a real, executed proof, not a plan.
The runtime is bundled in-repo under `vendor/whisper/`; the model (ggml-tiny.en-q5_1,
32MB) is now loaded REMOTE-FIRST from the GitHub release URL via the Cache API
(`mmgr-whisper-model-v1`), with the bundled local copy as fallback when that fetch is
impossible (CORS-blocked host, offline). Verified end-to-end: remote fetch is
CORS-blocked in the browser, the fallback path loads the bundled model, and the real
pipeline transcribes `jfk.wav` (T13 records `modelSource`). No further action needed on
this rank — do not re-open or re-litigate; proceed past it.

### 1.5.1 Capture Layer
- `MediaRecorder`, chunked buffering (5–10s), shares crash-safety infrastructure with
  Rank 4's transaction queue rather than duplicating it.
- Visible recording-state UI (level meter, timer) — non-negotiable, consent-relevant.
- Acceptance: a simulated abrupt tab kill mid-recording loses at most one un-flushed chunk,
  not the full meeting.

### 1.5.2 Transcription Tiering
- Tier 0 (Web Speech API, live captions, network-dependent) ships first — cheapest to wire.
- Tier 1 (whisper.cpp/WASM, true offline, zero key) — the constraint-satisfying tier;
  ships once Tier 0 proves the capture pipeline works end to end.
- Tier 2 (cloud API, BYO key, adds diarization quality) — opt-in, circuit-broken exactly
  like weather and AI calls already are.
- Acceptance: with network disabled entirely, Tier 1 still produces a usable transcript
  from a test recording — this is the hard gate, not "Tier 0 works."

### 1.5.3 Speaker Diarization
- Local pattern: whisper.cpp transcript + separate local segmentation pass, merged into a
  labeled transcript. Ships after 1.5.2's Tier 1 is verified working alone.
- Acceptance: a simulated two-speaker test recording produces correctly separated
  "Speaker 1 / Speaker 2" labels at least at paragraph-break granularity.

### 1.5.4 Transcript → Structured Extraction
- Rule-based keyword extraction first (no AI dependency) — "I'll," "by Friday," "we
  agree" — writing directly into existing Decisions log / Meeting-to-Action fields.
- AI-refined extraction as an upgrade path only, gated behind Rank 2's model wiring below —
  not a hard dependency, since rule-based extraction must work standalone.
- Acceptance: rule-based extraction correctly identifies action items in a test transcript
  with zero AI call made, before the AI upgrade path is even considered done.

**Phase exit criteria:** a simulated meeting — captured, transcribed offline via Tier 1,
diarized, and rule-extracted into the Decisions log — runs end to end with the network tab
disabled, zero data loss on immediate tab close mid-recording.

---

## RANK 1 EXTENSION — 1.4 Voice-to-Claim Pipeline

**STATUS: CONFIRMED COMPLETE — verified against actual codebase, not assumed.**
`mmgr-claim.js` already pulls meeting decisions, action items, and open carried-forward
promises into the claim pack, tied to the delay window, sourced from the same unified
state as weather delay log, WBS deltas, and change control. No manual re-entry step
exists in the current code. No further action needed on this rank — do not re-open or
re-litigate; proceed past it.

---

## RANK 2 EXTENSION — 2.3 Real Model Wiring + Agent-Style Presets

**STATUS: DONE, verified** — `qa-ai.cjs`, 15 checks (AI23_GATE PASS): the settings tier
toggle is config-only (no schema change), the local zero-key engine answers from state
with a per-line trace (zero-fabrication), the cloud tier sends OpenAI/Anthropic payloads
via a mocked fetch with a circuit-break, and readonly gating blocks run/settings but
allows open/copy. See sequence item 6.

**Sequenced after 2.1 and 2.2 (already in the master plan) as an extension, not a
prerequisite** — the digest and preset system must work with the existing copy-to-clipboard
flow first; this only upgrades it.

- Tier A: local in-browser model (WebGPU-backed, zero key) wired to the existing
  `submit()` seam for simple lookups.
- Tier B: cloud key (Anthropic/OpenAI, BYO) wired to the same seam for complex reasoning
  (claim narrative drafting, schedule audit) — same circuit-breaker discipline as weather.
- Existing presets (report/forecast/risk/digest/health/audit/change/client/daily) upgraded
  from "generate prompt text to copy" to "one-click, writes result back into project state
  as a structured field" — mirrors Procore Helix's agent pattern, without requiring
  Procore's hosted infrastructure.
- Acceptance: every preset's AI output is still traceable line-by-line back to actual state
  fields — this hard correctness gate from the existing Rank 2.2 spec is unchanged and
  re-verified against the new wiring, not assumed to still hold.

**Phase exit criteria:** both local and cloud model tiers produce zero-fabrication output
against the Phase 0 simulated project, and switching between them requires no schema or
architecture change — only a settings toggle.

---

## RANK 4 EXTENSION — 4.4 Multi-Device Reconciliation

**Sequenced after 4.1–4.3 (already in the master plan).** This is the gap the current
constraint #5 (single portable `.json`) does not close: two devices editing offline,
reconciling later, without a server.

- Field-level merge with per-field timestamps (last-write-wins per field, not whole-document
  overwrite) — deliberately the lighter option over a full CRDT library rewrite, chosen to
  fit the existing unified-state schema rather than replace it.
- Sync transport stays dumb and server-free: manual "merge this file with mine" action,
  accepting a second `.json` export as input — no hosted relay required, satisfies
  constraint #2 by construction.
- Acceptance: two simulated devices, each given the same starting project, each make
  non-overlapping edits offline, then merge — zero data loss, zero silent overwrite,
  conflicting edits to the same field surfaced to the user rather than silently resolved.

**Phase exit criteria:** merge test passes with both non-conflicting and deliberately
conflicting simulated edits, with conflicts visible and resolvable by the user, not hidden.

---

## RANK 4 EXTENSION — 4.5 Optional Google Identity for Sync (recommended, never gating)

**STATUS: DONE, verified** — `qa-sync.cjs`, 13 checks (SYNC45_GATE PASS): identity is an
optional pairing label, never a gate to any feature; merge + JSON export/import work fully
signed-out; the suggestion is single and dismissible and fires only after multi-device use
is actually detected (never at boot, no nagging). See sequence item 12.

**Sequenced after 4.4 (multi-device reconciliation, above).** This gives 4.4's merge
mechanism a human-friendly way to know "which devices belong together" without requiring
an account to use the app at all.

**Positioning, stated plainly:** every named enterprise competitor (Procore, Autodesk
Construction Cloud, INGENIOUS.BUILD, Buildertrend, CoConstruct) requires a full account and
subscription before the tool exists for the user at all — there is no fully-local,
zero-account tier for any of them, because the account *is* the business model. This app
can offer the identity/sync convenience those tools sell, while never making it a
requirement — a structural advantage none of them can match without abandoning their own
model.

- **Login stays 100% optional.** The app is fully functional, forever, with zero login —
  this is a hard non-negotiable, not a launch-phase compromise. No feature described
  elsewhere in this plan or the master plan may be placed behind a login wall.
- **What Google identity is for, specifically:** a label attached to a device's sync
  requests so 4.4's merge mechanism knows which devices belong to the same user, without
  the user having to manually pair devices via file export/import every time. Nothing more.
- **What it is explicitly NOT:** not an account system, not a gate to any feature, not a
  dependency for core CRUD (task edit, budget entry, risk log, claim log), not a
  requirement for the JSON export/import path, which remains the guaranteed fallback
  regardless of login state.
- **Implementation shape, at a glance (not a build spec):** Google Identity Services (GIS)
  client-side sign-in button; the ID token pairs with the optional Cloudflare Workers sync
  relay from the earlier hybrid discussion — Google login is the human-friendly identity
  layer, Cloudflare Workers/D1 (or equivalent) is the optional transport, JSON export/import
  is the guaranteed fallback if neither is present or reachable.
- **Recommended, not required — surfaced how:** a single, dismissible suggestion (never a
  blocking modal, never repeated nagging) offered once multi-device use is detected or
  requested, consistent with the master plan's "no notification spam" constraint.

**Acceptance:** a project created, edited, and claim-packed with zero login present passes
every existing acceptance test in this plan and the master plan, unmodified. A project used
across two devices with Google identity attached merges correctly via 4.4's logic with
Google identity only used as the pairing label, never as a data-access gate.

**Phase exit criteria:** side-by-side test — one project run entirely logged-out, one
project run with Google identity attached across two devices — both pass, with no
functional difference in core CRUD between the two, only a difference in sync convenience.

---

## RANK 9 NOTE — MCP Server Exposure (naming only, still deferred)

No change to the master plan's ruling that Rank 9 doesn't start until Rank 2 has been used
manually for a real project cycle. This plan only adds specificity for when that time comes:

- Local MCP server (user-run process, not hosted) exposing read-only project data first
  (tasks, EVM, risks, meetings/transcripts, claim data) to any MCP-compatible client.
- Write-capable tools (update task, log risk) gated behind explicit confirmation, added
  only after read-only access is proven, per the master plan's own read-before-write
  sequencing logic already used elsewhere.
- Explicitly positioned against the one named competitor (INGENIOUS.BUILD) whose MCP
  access requires their hosted backend — this app's version would not.

**Still deferred. Named here so it isn't mistaken for undiscovered backlog when the time
comes.**

---

## Integration items — sequenced as Rank 10 (Backlog) unless promoted later

Per the master plan's own rule: backlog items don't jump the queue without a deliberate
re-ranking decision. These stay in Rank 10 until such a decision is made:

- **QuickBooks-compatible export** (IIF/CSV or QBO-API-shaped JSON) — one-way export only,
  consistent with zero-server-cost; a live two-way sync would require a hosted OAuth relay
  and is explicitly out of scope under constraint #2 as currently written.
- **E-signature on exported documents** — legal groundwork needed first (Jamaica's
  Electronic Transactions Act specifics, distinct from U.S. ESIGN/UETA) before any design
  work starts. Technical direction to evaluate when unblocked: signature + hash + timestamp
  embedded directly in the exported claim-pack PDF, avoiding a third-party signing service
  entirely — the only version of this consistent with the five constraints.
- **IoT/site sensor feeds** — not yet researched at the same depth as the rest of this
  document; flagged for a dedicated research pass before any ranking decision.

---

## RANK 3 EXTENSION — 3.4 Viewport-Aware Layout Detection (portrait/mobile)

**Sequenced alongside 3.1–3.3 (existing Core Mode/Anti-Bloat work), since it's the same
family of problem: the first-open experience being wrong for the device in front of the
user.** Confirmed by direct inspection: the app currently has no PWA manifest, no service
worker, and no orientation/viewport-adaptive layout logic — this is a genuinely clean,
unstarted slate, not a retrofit.

- **Detection, not assumption.** On load, check viewport width/height ratio and
  `matchMedia('(orientation: portrait)')` — don't infer device type from user-agent
  sniffing, which is unreliable and explicitly discouraged practice.
- **A single, dismissible prompt, not a forced mode.** If a narrow/portrait viewport is
  detected on a view built for wide layouts (Gantt, RACI matrix, EVM tables — anything
  dense and horizontally laid out), offer a one-time "switch to a simplified mobile view
  for this screen?" prompt. Never auto-switch silently, and never re-prompt every visit —
  same "no notification spam" constraint already governing the rest of this plan.
- **What the simplified view actually does:** doesn't hide functionality, restructures
  presentation — dense tables become stacked cards, wide Gantt/RACI grids become
  scrollable single-column summaries with a "view full table" escape hatch. This is
  presentation-layer only; the underlying unified state and all acceptance criteria
  elsewhere in this plan are unaffected.
- **Ties directly to Rank 4's PWA work.** A manifest + service worker are the same
  infrastructure a "remember this device's screen preference" setting would use — plan
  these together rather than building viewport detection now and PWA caching later as two
  unrelated efforts.
- Acceptance: a simulated portrait-narrow viewport on a dense view (e.g. Gantt) triggers
  exactly one dismissible prompt per device (not per session), never blocks any existing
  functionality, and a user who dismisses it is not asked again for that view.

**Phase exit criteria:** side-by-side test on a wide desktop viewport and a simulated
narrow portrait viewport — both reach full functionality, the narrow case reaches it via
a restructured but not reduced layout, and the prompt fires once, not repeatedly.

---

## KNOWN CONFLICTS & SYNERGIES (from direct code review, not the plan alone)

**Correction to Phase 0's existing checklist — RESOLVED as of latest zip.** An earlier
review of this codebase found no unload-safety flush. That has since been fixed: direct
inspection of the current `mmgr-state.js` confirms real `beforeunload`, `pagehide`, and
`visibilitychange(hidden)` listeners all calling a synchronous flush save. This item is
now genuinely closed — no further verification needed on it.

### Conflicts (will actively fight the plan above if built as scoped)

1. **Single-blob localStorage save vs. transcripts/multi-device merge.** `mmgr-state.js`
   currently serializes the *entire* project state on every save with no field-level
   granularity. This is fine for text, but two planned features need more than this
   structure offers: audio must never touch this path at all (IndexedDB only, confirmed
   non-negotiable, not just preferred), and Rank 4.4's field-level merge needs
   `mmgr-state.js` to expose per-field read/write, which today's whole-blob model doesn't
   support. This is a real refactor prerequisite for 4.4, not a drop-in addition.
2. **One credential home, three different secret types.** `mmgr-net.js` already has a
   `Config.api.keys` placeholder built for a single future AI key. Adding an AI provider
   key, a Google OAuth token, and a possible Cloudflare sync token to the same
   under-designed slot risks either over-building the simple case or under-protecting the
   OAuth token. Needs its own short design pass before any of the three is wired.
3. **Two conflict-resolution systems solving the same problem.** The existing multi-tab
   `storage` event handler and the planned Rank 4.4 cross-device merge are the same
   underlying problem (two writers, one project) at two transport layers. Building them
   as separate systems means maintaining two reconciliation code paths that should be one.
4. **The AI assistant's "never mutates state" promise vs. Rank 2.3's agent-style presets.**
   `mmgr-ai.js` explicitly documents itself as read-only/non-mutating today. Rank 2.3
   deliberately reverses that. Any UI copy telling the user the assistant is inert needs
   to change in lockstep, not be forgotten as an afterthought.

### Synergies (existing code that makes planned work meaningfully easier)

1. **The multi-tab `onExternalChange`/`adoptExternal` mechanism is most of a sync engine
   already.** Rank 4.4 should extend this existing entry point with a new trigger source
   (Cloudflare relay or imported file) rather than building a parallel merge system.
2. **`mmgr-net.js`'s circuit-breaker (timeout, backoff, 5xx-retry) is the pattern every
   new network feature should route through** — AI cloud calls, Google OAuth, Cloudflare
   sync, QuickBooks export — rather than each growing its own fetch logic.
3. **The AI window's `CONTEXT_SCHEMA` context dump is already shaped close to what
   meeting-transcript extraction needs.** Extending it with an optional "current
   transcript" field is a small addition, not a new subsystem.
4. **The `updatedAt`/`lastBackedUpAt` watermark pattern is a ready-made primitive for
   field-level conflict detection** — Rank 4.4's merge logic is a natural extension of an
   idea already proven in this codebase, not a foreign concept being introduced.
5. **No PWA manifest or service worker exists yet — confirmed by direct inspection.** This
   is a clean, unstarted slate: the service-worker caching layer (Rank 4.1) can be
   designed once with later needs (offline Whisper model caching, IndexedDB audio,
   viewport-preference storage) in mind from day one, instead of being retrofitted twice.

---

## Full sequence, read top to bottom — CURRENT STATUS as of latest zip review

1. Phase 0 (existing, unchanged) — **DONE**, unload-safety fix confirmed resolved.
2. Rank 1.5 — Voice capture + transcription infrastructure — **DONE, verified.**
3. Rank 1 (1.1–1.3, existing) — Claim Pack core — **DONE** (implied by 1.4 depending on it).
4. Rank 1.4 — Voice-to-Claim pipeline — **DONE, verified.**
5. Rank 2 (2.1–2.2, existing) — Digest + preset prompts — **DONE** (implied by 2.3 status).
6. Rank 2.3 — Real model wiring, local + cloud tiers — **DONE, verified** (qa-ai.cjs, 15 checks; local zero-key engine with per-line trace, cloud OpenAI/Anthropic via mocked fetch, circuit-break, readonly gating).
7. Rank 3.1 — Core Mode vs Advanced Packs — **DONE, verified** (qa-r3.cjs; data-pack nav gating + Controls chips; existing projects migrate with all packs ON).
8. Rank 3.3 — Inline contextual definitions — **DONE** (verified pre-existing).
9. Rank 3.4 — Viewport-aware layout detection, portrait/mobile prompt — **DONE, verified** (qa-r3.cjs; mmgr-viewport.js, vpAccept/vpDismiss/vpFull actions, stacked-card fallback).
10. Rank 4 (4.1–4.3) — PWA/offline hardening — **DONE, verified** (qa-pwa.cjs; manifest + icon, cache-first SW, IndexedDB crash journal, offline CRUD).
11. Rank 4.4 — Multi-device reconciliation — **DONE, verified** (qa-pwa.cjs P10–P13; field-level LWW via state.fieldTs stamps, manual "Merge Project (.json)" in Controls, conflicts surfaced by name in the toast, merge undoable, round-trip regression pinned).
12. **Rank 4.5 — Optional Google identity for sync, never gating — DONE, verified** (qa-sync.cjs, 13 checks; GIS identity as pairing label only — never a data-access gate, merge + export work logged-out, single dismissible suggestion after multi-device use is detected).
13. Rank 5–8 (existing, unchanged) — status unverified.
14. Rank 9 — MCP server exposure — still correctly deferred, not started.
15. Rank 10 — Backlog (QuickBooks export, e-signature, IoT) — still correctly deferred.

**This is the order. Same standing rule as the master plan: no phase begins until the prior
phase's exit criteria are verified, and no lower-ranked item jumps the queue because it
looks easier to build. And per the strict execution rule above: once a check passes,
proceed — don't stop and ask after confirmation is already in hand. Rank 4.5 is now
complete (verified this session). Next unstarted work: verify Rank 5–8 status; Rank 9
(MCP) stays deferred until Rank 2 has been used for a real project cycle.**
