# My MaNaGeR — PLAN OF ACTION: Liquid Glass UI (Dual-Engine)
**Classification:** Planning document, reviewed against the actual codebase. Not approved
for build until reviewed with the person. Supplements the master plan and the
AI/voice/sync plan — does not replace or reorder either.

---

## 0. Source note — what this plan is built from

A document was supplied proposing a "3D Liquid Glass" visual effect (WebGL/Three.js,
refraction shaders, chromatic aberration) plus a follow-up "Dual-Engine" architecture
(a heavy Three.js path for capable devices, a CSS `backdrop-filter` fallback for
everything else). Two things are flagged here rather than silently carried forward:

- The original document's boilerplate contained `<script src="https://cloudflare.com">`
  labeled as "Three.js Core Library." That is not a real Three.js CDN link — it points at
  Cloudflare's homepage, not a script. Any real implementation needs a genuine Three.js
  CDN URL (e.g. `https://unpkg.com/three@<version>/build/three.module.js`), version-pinned
  and verified before use, not copied from the supplied text as-is.
- The document was written in a style addressed to a different conversation (it ends with
  its own "Would you like me to A/B/C" prompt). Its technical proposal — the two-tier
  CSS/WebGL architecture — is sound and is what this plan builds from, but it is treated
  as a reviewed third-party proposal, not as instructions carried through verbatim.

---

## 1. Codebase review — confirmed current state (verified by direct inspection)

Since the last review, real, correctly-sequenced progress has landed:

- **Rank 2.3 (real AI model wiring)** — CONFIRMED COMPLETE. `mmgr-ai.js` now has a real
  `submit()` seam with two tiers: a local tier and Tier B cloud (BYO key, OpenAI or
  Anthropic), routed through `MMGR.Net.post()` — reusing the existing circuit-breaker
  exactly as the plan specified, rather than growing new fetch logic.
- **Rank 3.4 (viewport-aware layout detection)** — CONFIRMED COMPLETE. `mmgr-viewport.js`
  exists, detects narrow/portrait viewports from actual viewport dimensions and
  `matchMedia` (not user-agent sniffing, per the plan's own requirement), offers a single
  dismissible per-device prompt, and stores the preference in the same device-level slot
  the PWA layer uses — correctly kept out of project state.
- **Rank 4.1 (PWA shell/service worker)** — CONFIRMED COMPLETE. `sw.js` and
  `manifest.webmanifest` both exist now (previously confirmed absent). The service worker
  is a cache-first app shell that explicitly passes network calls (weather, AI cloud)
  through untouched rather than intercepting them — correctly preserving the
  zero-server-cost circuit-breaker discipline rather than caching over it.
- **The Cloudflare 25MB deploy blocker is resolved** — the whisper model `.bin` file has
  been removed from `vendor/whisper/` and `mmgr-voice.js` now fetches it from a GitHub
  Releases URL with a `caches.open()` cache-on-first-use step, exactly the fix walked
  through earlier in this conversation. `wrangler.jsonc` is configured correctly for a
  static-assets Pages deploy.
- New QA gates (`qa-ai.cjs`, `qa-pwa.cjs`, `qa-r3.cjs`) exist as real test harnesses for
  each of the above, not just planning artifacts.

**This means the plan-of-action sequence from the prior document is now substantially
executed through Rank 4.1.** Rank 4.2–4.3, 4.4, and 4.5 remain open per that document's own
status tracking.

---

## 2. Where Liquid Glass fits — and where it doesn't

This is a **visual/presentation layer feature**, not a data or sync feature — it doesn't
touch unified state, doesn't add a network dependency (once the Three.js CDN choice is
pinned), and doesn't conflict with any Rank 1–4 item on inspection. But it does interact
directly with **Rank 3.4's viewport work already shipped**, and that interaction needs to
be designed on purpose rather than discovered as a conflict later.

### Direct interaction with Rank 3.4 (already shipped)
Rank 3.4 already restructures dense views (Gantt, RACI, budget, WBS, resources) into
simplified stacked layouts on narrow/portrait viewports. A heavy WebGL glass layer is
exactly the kind of cost Rank 3.4 exists to spare low-end/narrow-viewport devices from.
**Conclusion: the two features should share one detection path, not two.** The same
`isHighEnd`/viewport signal that decides simplified-vs-full layout should also gate
Liquid-Glass-vs-CSS-fallback, rather than introducing a second, separately-maintained
capability check.

---

## 3. Dual-Engine architecture — reviewed and adjusted

The supplied document's core idea (heavy WebGL engine for capable devices, CSS
`backdrop-filter` fallback for everyone else) is sound and is adopted, with these
adjustments made against the actual codebase:

- **Detection reuses `mmgr-viewport.js`'s existing signal**, extended with a
  hardware-capability check (`navigator.hardwareConcurrency`, `devicePixelRatio`) rather
  than introducing a separate detection module. One signal, two consumers (layout
  simplification and glass-engine selection).
- **The Three.js engine is dynamically imported, never bundled into the base deploy.**
  Given the 25MB Cloudflare Pages lesson just solved for the whisper model, Three.js
  (which is not small) must **never** be vendored into the repo the same way the model
  almost was. CDN-loaded, version-pinned, fetched only when the premium tier is actually
  selected — this also means users who never opt in pay zero cost for it, consistent with
  the "zero mandatory cost" spirit already governing this whole plan.
- **The CSS fallback (`backdrop-filter`) is the default, not the fallback-in-name-only.**
  Given the person's user base (construction PMs, often on job-site tablets or older
  hardware, per Garfield's own context), CSS glass should be the experience most people
  actually get, with WebGL as an opt-in "Premium" toggle — matching the document's own
  framing but stated plainly here as a product decision, not just a technical fallback.
- **No user account or server involvement.** The mode preference is a `localStorage` flag,
  same device-level slot family as Rank 3.4's viewport preference and Rank 4.5's future
  sync-identity slot — one consistent place for "how this device likes to look and
  behave," not three different storage patterns for three different UI preferences.

---

## 4. Sequencing — where this sits in the existing rank order

This is new work, not previously named in either existing plan file. It's sequenced as a
new **Rank 3.5**, directly after 3.4 since it shares the same detection signal and the
same "presentation only, never touches state" character as the rest of Rank 3.

### RANK 3 EXTENSION — 3.5 Dual-Engine Glass UI (Premium/CSS)

- **3.5.1 — CSS Glass (default, ships first).** `backdrop-filter` + gradient panel style,
  applied as the default `.glass-panel` treatment. Zero JS dependency, zero opt-in needed.
  Acceptance: every existing panel using card/panel styling renders with the glass
  treatment with no functional regression, tested on a simulated low-end/narrow viewport.
- **3.5.2 — Capability + preference detection.** Extend `mmgr-viewport.js`'s existing
  signal with `hardwareConcurrency`/`devicePixelRatio` checks; read/write the mode
  preference from the shared device-preference `localStorage` slot. Acceptance: detection
  correctly identifies a simulated low-end profile as CSS-only regardless of any stored
  "premium" preference — capability floor overrides preference, preference doesn't
  override a genuine incapability.
- **3.5.3 — Settings toggle.** A single, clearly-labeled toggle in the settings panel
  ("Premium visual mode — uses more graphics power"), off by default, persisted to the
  same slot. Never presented as a popup or forced prompt — user-initiated only, unlike
  Rank 3.4's one-time dismissible prompt, since this is a preference not a usability nudge.
- **3.5.4 — Liquid Glass engine (opt-in, dynamically imported).** Three.js loaded from a
  pinned CDN URL only when 3.5.2's detection and 3.5.3's toggle both allow it. Verify the
  real CDN URL and version at implementation time — do not carry forward the placeholder
  `cloudflare.com` reference from the source document. **Pinned at implementation time:
  `https://unpkg.com/three@0.160.0/build/three.module.js` (reachability verified, version
  locked).** Acceptance: with the toggle off,
  zero Three.js network request is made, verified via network tab — this is the hard gate
  proving the "zero cost unless opted in" property actually holds, not just in design intent.
- **3.5.5 — Shared teardown on mode switch.** Switching from Premium back to CSS mode (or
  on a capability re-check, e.g. resize into a narrow viewport) must cleanly dispose of the
  Three.js renderer/scene, not leave a hidden WebGL context running. Acceptance: toggling
  Premium on/off repeatedly does not leak WebGL contexts (checkable via
  `WEBGL_lose_context` / browser dev tools context count).

**Phase exit criteria:** CSS glass ships and is visually verified as the universal default;
Premium mode is fully inert (zero network, zero WebGL context) until explicitly toggled on
by a capable device; toggling between modes leaves no leaked resources.

---

## 6. Verification checklist — required before Rank 3.5 begins

Per this plan's own standing rule ("not assumed, VERIFIED"), the following items were
flagged above as status-unverified. Before Rank 3.5 (or anything after it) begins,
whoever/whatever executes this plan must directly inspect the codebase for each of these
— not assume completion from prior planning documents — and update this file's status
lines accordingly:

- **Rank 3.1–3.3 (Progressive disclosure / Anti-Bloat, existing master plan items).**
  Check for: a Core Mode vs. Full Mode toggle or equivalent, evidence of panels/sections
  being hidden or collapsed by default, and any existing QA gate covering this (e.g. a
  `qa-core-mode.cjs` or similar). If no such gate exists, that absence is itself a finding
  to record, not something to infer either way.
- **Rank 4.2–4.3 (remaining PWA hardening beyond the shell/service worker in 4.1).** Check
  for: offline fallback behavior beyond the cached shell (e.g. queued writes while
  offline, a visible offline/online indicator), and confirm `qa-pwa.cjs`'s actual check
  count and content — 15 checks were counted in this session's review, but their specific
  coverage (shell caching only vs. broader offline hardening) was not enumerated and needs
  a direct read, not an assumption from the count alone.

**Section 6 resolution — both items CONFIRMED DONE (verified directly this session by
running the gates, not assumed):**

- **Rank 3.1–3.3: CONFIRMED DONE.** There is no `qa-core-mode.cjs` — that absence was
  recorded as directed, and the coverage lives in `qa-r3.cjs` (13 checks, R3_GATE PASS):
  Core Mode vs Advanced Packs data-pack nav gating + Controls chips, existing projects
  migrate with all packs ON, readonly gating. Inline contextual definitions exist in
  `js/mmgr-defs.js`. Nothing else was inferred.
- **Rank 4.2–4.3: CONFIRMED DONE.** `qa-pwa.cjs`'s actual check count is **13 (P01–P13),
  not the 15 estimated in the review above** — the count is corrected here, and its
  coverage is broader than shell caching: IndexedDB crash journal with wiped-LS restore,
  100% offline core CRUD with network disabled, and field-level LWW merge (P10–P13).
  PWA4_GATE PASS.

**Verification method:** the same approach used elsewhere in this plan — `grep`/direct file
inspection for the relevant module and QA gate names, confirm the gate actually runs and
passes, and only then mark status as DONE. If a rank is found partially built, record
specifically what's missing rather than marking it wholesale NOT STARTED or DONE.

**This check is a precondition, not an optional aside — do not begin Rank 3.5 build work
until this section's items are resolved to CONFIRMED DONE, CONFIRMED PARTIAL (with the gap
named), or CONFIRMED NOT STARTED. Once resolved, per the standing execution rule, proceed
without pausing to ask.**

---

## 7. Updated full sequence (status as of this review)

1. Phase 0 — **DONE.**
2. Rank 1.5 (Voice capture/transcription) — **DONE, verified.**
3. Rank 1 (1.1–1.3, Claim Pack core) — **DONE.**
4. Rank 1.4 (Voice-to-Claim pipeline) — **DONE, verified.**
5. Rank 2 (2.1–2.2, Digest + presets) — **DONE.**
6. Rank 2.3 (Real model wiring) — **DONE, verified this session.**
7. Rank 3 (3.1–3.3, Progressive disclosure) — **DONE, verified this session** (qa-r3.cjs,
   13 checks; Core/Advanced pack gating + Controls chips; no separate qa-core-mode.cjs —
   qa-r3 is the gate; defs.js present).
8. Rank 3.4 (Viewport-aware layout) — **DONE, verified this session.**
9. **Rank 3.5 (Dual-Engine Glass UI) — DONE, verified** (qa-glass.cjs, 12 checks G01–G12,
   GLASS35_GATE PASS; CSS glass ships as the default card treatment; capability floor
   overrides stored premium pref; premium inert until toggle — zero Three.js import with
   the toggle off (hard gate); Three.js pinned to unpkg three@0.160.0; shared teardown
   disposes renderer + loses WebGL context; 4 on/off cycles leak nothing).
10. Rank 4.1 (PWA shell/service worker) — **DONE, verified this session.**
11. Rank 4.2–4.3 (remaining PWA hardening) — **DONE, verified this session** (qa-pwa.cjs,
    13 checks P01–P13; crash journal, offline CRUD, merge — see Section 6 resolution).
12. Rank 4.4 (Multi-device reconciliation) — **DONE, verified this session** (qa-pwa.cjs
    P10–P13; field-level LWW via state.fieldTs, manual Merge Project, conflicts surfaced,
    undoable, round-trip pinned).
13. Rank 4.5 (Optional Google identity for sync) — **DONE, verified this session**
    (qa-sync.cjs, 13 checks S01–S13; identity = pairing label only, never a gate; merge +
    export fully signed-out).
14. Rank 5–8 — status unverified.
15. Rank 9 (MCP server exposure) — still correctly deferred.
16. Rank 10 (Backlog: QuickBooks, e-signature, IoT) — still correctly deferred.

**Per the standing execution rule already governing this plan: a passed check is not a
pause point. Section 6's verification checklist was resolved to CONFIRMED DONE (see
above), and Rank 3.5 was built and verified (qa-glass.cjs) in the same session. Next
candidate: verify Rank 5–8 status.**
