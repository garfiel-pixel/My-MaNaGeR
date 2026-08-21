# My MaNaGeR — QA Runbook

The app is a pure client-side SPA (localStorage + optional Open-Meteo), so all
verification is done by driving headless Chrome against a local static server.
Chrome must be installed at `C:\Program Files\Google\Chrome\Application\chrome.exe`
(the path is hard-coded in each `qa-*.cjs` harness).

## 1. Start the dev server

```bash
node serve.cjs        # serves the project on http://localhost:8765
```

Zero-dependency static server; dev tooling only. Keep it running while the
batteries run (each harness launches its own headless Chrome profile).

## 2. The gates (run after every phase)

```bash
node qa-p0.cjs     # PHASE 0 gate — date-edit fighting bug (13 checks)
node qa-p1.cjs     # PHASE 1 gate — tab-switch / def / persist / kanban / import (5)
node qa-v11.cjs    # PHASE 2/3 gate — flags / error log / Net retry / idempotent import / Config / AI dump (23)
node qa-ai.cjs     # RANK 2.3 gate — real model wiring: config tier toggle
                   #   (no schema change), local zero-key engine with per-line
                   #   trace (zero-fabrication), cloud OpenAI/Anthropic payloads
                   #   via mocked fetch, circuit-break, readonly gating (15)
node qa-r3.cjs     # RANK 3 gate — Core Mode vs Advanced Packs (3.1): new projects
                   #   Core-only, single-action pack toggles, readonly gate;
                   #   Viewport detection (3.4): one dismissible prompt per
                   #   device, simplified view + escape hatch, no re-prompt (13)
node qa-pwa.cjs    # RANK 4 gate — PWA manifest + cache-first SW registration,
                   #   IndexedDB crash journal (4.2: wiped-LS restore), and
                   #   100% offline core CRUD with network disabled (4.3), and
                   #   field-level LWW merge (4.4): per-field timestamps adopt
                   #   only strictly-newer, ties keep local (13)
node qa-voice.cjs  # RANK 1.5 gate — voice capture: chunked IndexedDB persistence,
                   #   abrupt-kill durability, Tier 0 circuit-break, zero-AI
                   #   transcript extraction into Decision Log + promises,
                   #   Tier 1 offline whisper: DSP, circuit-break, retry (37)
                   # OPT-IN real offline pipeline (worker+wasm+model+decode):
RUN_WHISPER=1 node qa-voice.cjs   # ~1-2 min; proves the whisper runtime
                   #   transcribes the reference jfk.wav end to end through
                   #   the real IndexedDB chunk path (T10-T12); model loads
                   #   remote-first (Cache API) from the CORS-enabled Hugging
                   #   Face mirror with bundled local copy as fallback (T13)
node qa-glass.cjs  # RANK 3.5 gate — Dual-Engine Glass UI: CSS glass ships as
                   #   the default .card treatment, capability + preference
                   #   detection (low-end floor overrides pref), settings
                   #   toggle off-by-default, premium inert until toggled
                   #   (zero-net hard gate), pinned Three.js @0.160.0, shared
                   #   teardown — repeated on/off cycles leak no WebGL (12)
node qa-sync.cjs   # RANK 4.5 gate — optional Google identity for sync: never
                   #   gating, identity = pairing label only, merge + JSON
                   #   export/import fully working signed-out, single
                   #   dismissible suggestion after multi-device use (13)
node qa-drive-smoke.cjs
                   # GOOGLE-DRIVE-BACKUP smoke — app.html auth-bar wiring,
                   #   module API surface (backup/restore/token, drive.file
                   #   scope), project.html Controls-drawer section, and
                   #   no-session graceful degradation. HARNESS LIMITATION
                   #   (DIR-3): no live Google credentials, so the REAL
                   #   sign-in → Drive round-trip is verified MANUALLY on
                   #   the deployed URL with a real Google account — this
                   #   harness is a wiring/regression gate only, not proof
                   #   of the live Drive path.
node qa-oauth.cjs  # GOOGLE-OPERATOR-IDENTITY-v1 gate — optional operator
                   #   identity on app.html/admin.html: auth-bar mount points,
                   #   GIS wiring (mock GIS injected, real GIS blocked),
                   #   sign-in success/failure paths, /api/auth/me restore,
                   #   sign-out, zero page exceptions, access-code unlock
                   #   completely untouched (11). NOTE: requires the Worker
                   #   /api/auth/* routes in production; locally the harness
                   #   mocks fetch, so serve.cjs needs no API routes.
node tools/verify-auth-worker.mjs
                   # GOOGLE-OPERATOR-IDENTITY-v1 Worker gate (26 checks):
                   #   /api/auth/google 400/401/200 + cookie flags, HMAC
                   #   forgery/tamper/expiry resistance, /api/auth/me,
                   #   logout + logout-CSRF guard, /api/* 404 JSON (never SPA
                   #   fallback), header decoration + whisper CSP scoping
                   #   + traversal guard, CSP GIS origins + D2d parity.
                   #   Dev tooling — imports worker.js with stubbed fetch.
node qa-full.cjs   # full 167-check battery (schema v10 features + regressions)
node qa-restore-verify.cjs
                   # MONOLITH-FEATURE-PARITY restoration gate (14 checks):
                   #   risk matrix click-to-filter + clear, Import Dates
                   #   Copy List, email templates, print/save charter,
                   #   WBS schedule-issues banner (needs demo-project seed)
node qa-obs-verify.cjs
                   # OBSERVABILITY-SECURITY gate (11 checks): error-log
                   #   Copy/Download wiring + formatter, DIR-1b remote
                   #   reporting (OFF -> zero Net.post, ON -> exactly one
                   #   via MMGR.Net with maxRetries 0, dead endpoint
                   #   degrades silently, device slot persists), and the
                   #   five security headers on the wire. Serve the REAL
                   #   CSP locally (serve.cjs mirrors worker.js) so the
                   #   whole battery exercises the deployed policy.
```

## 6. OBSERVABILITY-SECURITY notes

- **DIR-1a error log export:** Copy (clipboard) + Download (.txt) buttons in
  the Controls drawer consume `MMGR.Errors.getLog()` — the same data source
  the drawer renders. Plain-text lines match the ts / action / msg columns.
- **DIR-1b remote error reporting:** opt-in toggle + webhook URL in the
  Controls drawer, OFF by default. The slot is device-level localStorage
  (`mmgr_err_report` / `mmgr_err_webhook`), never project state — it cannot
  travel in the .json export. New entries POST through `MMGR.Net.post` with
  `maxRetries: 0` (exactly one attempt, no retry storm); a failure degrades
  silently to "logged locally only" and never re-enters the error path.
  Toggle OFF means ZERO network activity (verified by stub in qa-obs-verify).
- **DIR-2 headers:** Workers static-assets does NOT honor a `_headers` file
  (Pages-only — verified against current Cloudflare docs), so the five
  headers ship via a thin Worker (`worker.js`, `env.ASSETS.fetch()`);
  wrangler.jsonc gained `"main": "worker.js"`. This is the app's first
  server-side code — deliberately minimal (no state, no storage, no other
  bindings). `serve.cjs` mirrors the exact headers so QA runs under the real
  CSP.
- **CSP maintenance (read before editing any inline `<script>`):** every
  served page's inline script is allow-listed by SHA-256 hash INSIDE the
  `script-src` directive in BOTH worker.js and serve.cjs. If an inline
  `<script>` in any served .html changes, its hash must be regenerated or
  that page is silently blocked (no error). Regenerate with the node command
  documented in the worker.js header comment, then update both files.
- **CSP origins (verified, not assumed):** Three.js loads from unpkg.com
  (three@0.160.0, js/mmgr-glass.js); the whisper model fetches from
  huggingface.co (NOT GitHub — the release URL is CORS-blocked; the spec's
  "GitHub Releases origin" memory was stale). `connect-src https:` covers
  both plus the user-supplied webhook/AI endpoints by design (BYO-endpoint
  architecture). `'wasm-unsafe-eval'` enables the bundled whisper WASM only.


Legacy probes (superseded by qa-p0, kept as focused regression probes):

```bash
node qa-focus.cjs  # focus/rebuild behavior on change-triggered re-renders
node qa-typing.cjs # WBS typing survives updTaskField re-render
```

Every harness exits 0 only when every check passes and prints a `PASS` line
(`P0_GATE PASS`, `QA SUMMARY: 167 passed / 0 failed of 167`, ...).

## 3. Phase gates

- **Phase 0 (P0 — date-edit fighting):** qa-p0.cjs installs render spies and
  drives REAL click events on WBS date inputs, selects and text fields to prove
  a date edit never rebuilds the WBS row, never recreates the input, never
  preventDefaults the native picker, and leaves adjacent fields editable.
- **Phase 1 (interaction correctness):** qa-p1.cjs covers Charter repaint on tab
  switch, Definitions panel paint, theme+crosshair persistence across a hard
  refresh, Kanban Completed drop visibility, and full-surface import refresh.
- **Phase 2/3:** qa-v11.cjs covers feature flags (state + gating + persistence),
  the client error log (20-entry cap, hooks, clear), MMGR.Net retry/backoff
  semantics, idempotent WBS/dates import, MMGR.Config, and the AI context dump
  contract (CONTEXT_SCHEMA).
- **Rank 2.3:** qa-ai.cjs covers the real model wiring — the settings toggle
  (tier switch is config-only, no schema bump), the local zero-key engine
  (every output writes state.aiOutputs[type] with a trace array of the state
  fields used; free-form lookups answer from state; no network touches the
  local tier), the cloud tier (OpenAI + Anthropic payload shapes against a
  mocked fetch, circuit-break on failure returns ok:false with state intact),
  and view-only gating (run/settings blocked, open/copy allowed).

## 4. Shipping rules

- No file ships until `qa-p0.cjs` is green.
- Every completed task is re-run through its gate before the next task starts.
- Zero new inline styles or inline handlers;  CSP intact; no emojis; all new UI
  uses the existing design tokens (css/mmgr.css); every destructive mutation
  goes through `State.updateState` + `pushUndo`.

## 5. Rank 1.5 Tier 1 (offline whisper WASM) notes

- Runtime is bundled in-repo under `vendor/whisper/` (provenance and sizes
  in `vendor/whisper/README.md`). Model: ggml-tiny.en-q5_1 (32 MB), loaded
  remote-first via Cache API (`mmgr-whisper-model-v1`) from the Hugging Face
  mirror `huggingface.co/ggerganov/whisper.cpp` (CORS-enabled — verified
  `Access-Control-Allow-Origin: *`), with the bundled local copy as fallback
  when the remote fetch is impossible (offline). The previously-referenced
  GitHub release URL is CORS-blocked in browsers (no ACAO header) and must
  not be used as the remote source; this was fixed in the same session that
  verified T10–T13 end-to-end.
- The page CSP includes `script-src 'wasm-unsafe-eval'` — the narrow WASM
  allowance; it enables no eval(). `connect-src` additionally allows
  `huggingface.co` and `*.cdn.hf.co` (the mirror's redirect target).
- `serve.cjs` maps `.wasm` -> application/wasm and `.bin` -> octet-stream.
- Tier 1 is batch-on-stop, runs in a module worker, and is circuit-broken:
  any failure keeps the hand-editable Tier 0 captions and never blocks
  ending a meeting.
